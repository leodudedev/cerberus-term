import { Layout } from './Layout.js';
import { openConfigEditor } from './ConfigEditor.js';
import { toggleFavorite } from './favorites.js';
import { openFavoritesOverlay } from './FavoritesOverlay.js';
import { makeMuteToggle } from './MuteToggle.js';
import {
  newLeaf,
  splitLeaf,
  killLeaf,
  firstLeaf,
  leaves,
  setRatio,
  resizeNearest,
  type Dir,
  type PaneNode
} from './pane-tree.js';
import { loadWorkspace, saveWorkspace, type SavedTab } from './persistence.js';
import { confirmDialog } from './ConfirmDialog.js';
import type { EditAction, OpenPanePayload, TabAction } from './cerberus.js';

const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

let tabSeq = 0;
const genTabId = (): string => `tab-${Date.now().toString(36)}-${(tabSeq++).toString(36)}`;

// One workspace tab: its own pane tree + Layout, rendered into a dedicated
// container that is display-toggled so inactive tabs keep their live shells.
interface Tab {
  id: string;
  root: PaneNode;
  focusedLeafId: string;
  layout: Layout;
  container: HTMLElement;
  savedCwds: Record<string, string>;
  // User-set label; when unset the tab shows a positional "Terminale N".
  customTitle?: string;
  // A pane in this (inactive) tab is asking for a permission. Drives the tab
  // chip's attention blink; cleared when the tab is activated.
  attention?: boolean;
}

// A browser/iTerm-style tab strip on top of a splittable pane layout. Owns the
// full workspace: tab lifecycle, the active tab's pane operations, and
// persistence of the whole set.
export class Workspace {
  private tabs: Tab[] = [];
  private activeId = '';
  private readonly tabBarEl: HTMLElement;
  private readonly viewport: HTMLElement;
  private persistTimer: number | undefined;
  private skipCloseConfirm = false;

  constructor(host: HTMLElement) {
    host.style.cssText = 'width:100vw;height:100vh;background:var(--bg)';
    const wrap = document.createElement('div');
    wrap.className = 'workspace';

    const bar = document.createElement('div');
    bar.className = 'tabbar';

    // Chips scroll; the trailing actions stay pinned to the right edge. The
    // mute toggle is built once and lives outside the chip strip, so a tab-bar
    // re-render can't tear it down mid-flight.
    this.tabBarEl = document.createElement('div');
    this.tabBarEl.className = 'tabbar-tabs';

    // "New tab" sits with the actions, not at the end of the chip strip: past
    // ~8 tabs the strip scrolls, and a + that scrolls out of reach is a + you
    // can't click. Built once for the same reason as the mute toggle.
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tab-new';
    add.textContent = '+';
    add.title = 'New tab (Cmd+T)';
    add.addEventListener('click', () => this.newTab());

    const actions = document.createElement('div');
    actions.className = 'tabbar-actions';
    actions.append(add, makeMuteToggle());

    // A trackpad swipes the strip horizontally on its own; a plain mouse wheel
    // only reports deltaY, which would otherwise do nothing here.
    this.tabBarEl.addEventListener(
      'wheel',
      (e) => {
        if (e.deltaX !== 0 || e.shiftKey) return; // already horizontal
        if (this.tabBarEl.scrollWidth <= this.tabBarEl.clientWidth) return;
        e.preventDefault();
        this.tabBarEl.scrollLeft += e.deltaY;
      },
      { passive: false }
    );

    // Neither scrolling nor resizing the window goes through renderTabBar, and
    // both change which edge has chips hidden behind it.
    this.tabBarEl.addEventListener('scroll', () => this.syncTabOverflow(), { passive: true });
    new ResizeObserver(() => this.syncTabOverflow()).observe(this.tabBarEl);

    bar.append(this.tabBarEl, actions);

    this.viewport = document.createElement('div');
    this.viewport.className = 'tabs-viewport';

    wrap.append(bar, this.viewport);
    host.replaceChildren(wrap);
  }

  // Restore persisted tabs (or start with one) and begin periodic snapshots.
  async start(): Promise<void> {
    const saved = loadWorkspace();
    // Ptys that outlived the previous renderer (a reload, a crash, dev HMR).
    // Any leaf whose saved pty is in here reattaches to the running shell
    // instead of spawning a fresh one, so the session inside it survives.
    let alive = new Set<string>();
    try {
      alive = new Set(await window.cerberus.list());
    } catch {
      /* no surviving ptys — every pane spawns clean */
    }

    if (saved && saved.tabs.length) {
      for (const st of saved.tabs) this.createTab(st, alive);
      this.activeId = this.tabs.some((t) => t.id === saved.activeTabId)
        ? saved.activeTabId
        : this.tabs[0]!.id;
    } else {
      this.createTab();
      this.activeId = this.tabs[0]!.id;
    }

    // Build every tab's panes up front so restore brings all shells back; the
    // deferred-fit guard keeps hidden tabs from mis-sizing until shown.
    for (const t of this.tabs) t.layout.render(t.root);
    this.showActive();
    this.renderTabBar();
    // Anything the restore didn't claim is a leftover from a layout that no
    // longer exists: kill it rather than leave a headless shell running.
    void this.reapOrphanPtys();

    // Close-confirm preference (cached; refreshed when settings are saved).
    void this.loadCloseConfirm();
    window.addEventListener('settings-changed', () => void this.loadCloseConfirm());

    // Periodic snapshot: refresh cwds/titles/favorites and persist (catches a
    // bare `cd` with no structural change) across all tabs.
    //
    // Skipped while the window has no focus: the snapshot reads every pane's
    // live cwd, which forks an lsof on macOS, and a `cd` gets typed into a
    // window someone is looking at. One snapshot on the way out and one on the
    // way back in covers whatever a background agent changed meanwhile.
    window.setInterval(() => {
      if (document.hasFocus()) void this.persistNow();
    }, 4000);
    window.addEventListener('focus', () => void this.persistNow());
    window.addEventListener('blur', () => void this.persistNow());

    // Last write before the renderer goes away (Cmd+R, window close). The ptys
    // outlive it in main, so this snapshot is what decides which of them get
    // reattached and which get reaped.
    window.addEventListener('beforeunload', () => this.persistSync());
  }

  // ---- tab lifecycle ------------------------------------------------------

  private createTab(saved?: SavedTab, alivePtys?: Set<string>): Tab {
    const id = saved?.id ?? genTabId();
    const container = document.createElement('div');
    container.className = 'tab-container';
    this.viewport.append(container);

    const savedCwds = saved?.cwds ?? {};
    const root: PaneNode = saved?.tree ?? newLeaf();

    const layout = new Layout(
      container,
      (leafId) => {
        const t = this.byId(id);
        if (t) {
          t.focusedLeafId = leafId;
          // Focusing a pane clears its pending-permission highlight.
          t.layout.clearLeafAttention(leafId);
        }
      },
      (splitId, ratio) => {
        const t = this.byId(id);
        if (t) {
          t.root = setRatio(t.root, splitId, ratio);
          this.schedulePersist();
        }
      },
      (leafId) => savedCwds[leafId]
    );

    // Mark the leaves whose pty is still running: Layout hands the id to the
    // pane, which reattaches and replays instead of starting a new shell.
    if (saved?.ptys && alivePtys) {
      for (const [leafId, paneId] of Object.entries(saved.ptys)) {
        if (alivePtys.has(paneId)) layout.setPaneSpec(leafId, { attachPaneId: paneId });
      }
    }

    const focusedLeafId =
      saved?.focusedLeafId && leaves(root).some((l) => l.id === saved.focusedLeafId)
        ? saved.focusedLeafId
        : firstLeaf(root).id;

    const tab: Tab = {
      id,
      root,
      focusedLeafId,
      layout,
      container,
      savedCwds,
      ...(saved?.title ? { customTitle: saved.title } : {})
    };
    this.tabs.push(tab);
    return tab;
  }

  newTab(): void {
    const t = this.createTab();
    this.activeId = t.id;
    t.layout.render(t.root);
    this.showActive();
    this.renderTabBar();
    this.schedulePersist();
  }

  async closeTab(id: string): Promise<void> {
    if (!this.byId(id)) return;
    if (!(await this.confirmClose('tab'))) return;
    this.doCloseTab(id);
  }

  private doCloseTab(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [t] = this.tabs.splice(idx, 1);
    t!.layout.render(null); // dispose every pane + pty in the tab
    t!.container.remove();

    if (this.tabs.length === 0) {
      // Closing the last tab closes the window (browser/iTerm convention).
      window.cerberusUI.closeWindow();
      return;
    }
    if (this.activeId === id) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)]!;
      this.activeId = next.id;
      this.showActive();
    }
    this.renderTabBar();
    this.schedulePersist();
  }

  selectTab(id: string): void {
    if (id === this.activeId || !this.byId(id)) return;
    this.activeId = id;
    // Viewing the tab clears its chip blink; per-pane borders stay until each
    // pane is focused.
    const t = this.byId(id);
    if (t) t.attention = false;
    this.showActive();
    this.renderTabBar();
    this.schedulePersist();
  }

  // Daemon fork: a pane (by paneId) is asking for a permission. Flash it, and
  // blink its tab chip when that tab isn't the one on screen.
  async markPaneAttention(paneId: string): Promise<void> {
    for (const t of this.tabs) {
      const leafId = await t.layout.leafForPaneId(paneId);
      if (!leafId) continue;
      const isActiveFocused = t.id === this.activeId && t.focusedLeafId === leafId;
      if (isActiveFocused) return; // you're already looking at it
      t.layout.markLeafAttention(leafId);
      if (t.id !== this.activeId) {
        t.attention = true;
        this.renderTabBar();
      }
      return;
    }
  }

  private cycle(delta: number): void {
    if (this.tabs.length < 2) return;
    const idx = this.tabs.findIndex((t) => t.id === this.activeId);
    const next = this.tabs[(idx + delta + this.tabs.length) % this.tabs.length]!;
    this.selectTab(next.id);
  }

  private selectIndex(i: number): void {
    const t = this.tabs[i];
    if (t) this.selectTab(t.id);
  }

  // Edit menu -> clipboard. Only claims the action when a terminal actually has
  // focus: the settings modal's inputs must keep the native behaviour, and
  // `.xterm` is the one wrapper that tells the two apart. Returns false so the
  // caller can hand the action back to Chromium.
  handleEdit(action: EditAction, text?: string): boolean {
    // Find is unconditional: it targets the focused pane, and the whole point of
    // the shortcut is that it works while the find bar's own input has focus.
    if (action === 'find') {
      this.active()?.layout.openSearch();
      return true;
    }
    if (!document.activeElement?.closest('.xterm')) return false;
    const pane = this.byId(this.activeId)?.layout.focusedPane();
    if (!pane) return false;
    if (action === 'copy') return pane.copySelection();
    pane.pasteText(text ?? '');
    return true;
  }

  handleTabAction(action: TabAction, index?: number): void {
    if (action === 'new') this.newTab();
    else if (action === 'close') void this.closeTab(this.activeId);
    else if (action === 'next') this.cycle(1);
    else if (action === 'prev') this.cycle(-1);
    else if (action === 'select' && index !== undefined) this.selectIndex(index);
  }

  private showActive(): void {
    for (const t of this.tabs) {
      t.container.style.display = t.id === this.activeId ? 'block' : 'none';
    }
    const t = this.active();
    if (!t) return;
    t.layout.refit(); // panes deferred their fit while hidden
    t.layout.focusLeaf(t.focusedLeafId);
  }

  private titleOf(t: Tab, index: number): string {
    return t.customTitle || `Terminale ${index + 1}`;
  }

  private renderTabBar(): void {
    this.tabBarEl.replaceChildren();
    let activeChip: HTMLElement | null = null;

    this.tabs.forEach((t, index) => {
      const chip = document.createElement('div');
      chip.className =
        'tab-chip' +
        (t.id === this.activeId ? ' active' : '') +
        (t.attention ? ' attention' : '');
      if (t.id === this.activeId) activeChip = chip;

      const label = this.titleOf(t, index);
      const title = document.createElement('span');
      title.className = 'tab-chip-title';
      title.textContent = label;
      title.title = 'Double-click to rename';
      // Double-click a tab to rename it (empty resets to the default label).
      title.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.startRename(chip, t, label);
      });

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-chip-close';
      close.textContent = '✕';
      close.title = 'Close tab';
      close.addEventListener('pointerdown', (e) => e.stopPropagation());
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(t.id);
      });

      chip.append(title, close);
      chip.addEventListener('pointerdown', () => this.selectTab(t.id));
      this.tabBarEl.append(chip);
    });

    this.syncTabOverflow();
    // Cmd+1..9 and Ctrl+Tab can land on a chip that's scrolled out of sight.
    (activeChip as HTMLElement | null)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Fade an edge only while chips are hidden past it: fading the right one at
  // the end of the strip would dim the last chip to suggest more that isn't
  // there. 1px of slack absorbs sub-pixel widths.
  private syncTabOverflow(): void {
    const el = this.tabBarEl;
    const hidden = el.scrollWidth - el.clientWidth;
    el.classList.toggle('fade-left', hidden > 1 && el.scrollLeft > 1);
    el.classList.toggle('fade-right', hidden > 1 && el.scrollLeft < hidden - 1);
  }

  // Inline rename: swap the label for a text input over the chip. Enter/blur
  // commits (empty clears the custom name -> default label), Escape cancels.
  private startRename(chip: HTMLElement, t: Tab, current: string): void {
    const input = document.createElement('input');
    input.className = 'tab-chip-input';
    input.value = t.customTitle ?? '';
    input.placeholder = current;
    input.addEventListener('pointerdown', (e) => e.stopPropagation());

    let done = false;
    const commit = (save: boolean): void => {
      if (done) return;
      done = true;
      if (save) {
        const v = input.value.trim();
        t.customTitle = v || undefined;
        this.schedulePersist();
      }
      this.renderTabBar();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        commit(false);
      }
    });
    input.addEventListener('blur', () => commit(true));

    chip.replaceChildren(input);
    input.focus();
    input.select();
  }

  // ---- active-tab pane operations -----------------------------------------

  private active(): Tab | undefined {
    return this.byId(this.activeId);
  }

  private byId(id: string): Tab | undefined {
    return this.tabs.find((t) => t.id === id);
  }

  private rerender(t: Tab, nextFocus: string): void {
    t.layout.render(t.root);
    t.focusedLeafId = nextFocus;
    if (t.id === this.activeId) t.layout.focusLeaf(nextFocus);
    this.schedulePersist();
  }

  private async split(dir: Dir, leafId: string): Promise<void> {
    const t = this.active();
    if (!t) return;
    // Inherit the source pane's live cwd so the new pane opens in the same dir.
    let cwd: string | undefined;
    try {
      const srcPaneId = await t.layout.paneIdOf(leafId);
      if (srcPaneId) cwd = await window.cerberus.cwd(srcPaneId);
    } catch {
      /* source pane gone — fall back to default cwd */
    }
    const { root: next, newLeafId } = splitLeaf(t.root, leafId, dir);
    t.root = next;
    if (cwd) t.layout.setPaneSpec(newLeafId, { cwd });
    this.rerender(t, newLeafId);
  }

  private async kill(leafId: string): Promise<void> {
    if (!(await this.confirmClose('pane'))) return;
    this.doKill(leafId);
  }

  private doKill(leafId: string): void {
    const t = this.active();
    if (!t) return;
    const next = killLeaf(t.root, leafId);
    // Killing the last pane in a tab respawns a fresh one (the tab stays alive;
    // Cmd+W is the way to close a tab).
    t.root = next ?? newLeaf();
    const stillFocused = leaves(t.root).some((l) => l.id === t.focusedLeafId);
    this.rerender(t, stillFocused ? t.focusedLeafId : firstLeaf(t.root).id);
  }

  handlePaneCmd(cmd: string, leafId?: string): void {
    const t = this.active();
    if (!t) return;
    const target = leafId ?? t.focusedLeafId;

    if (cmd === 'split-right') void this.split('row', target);
    else if (cmd === 'split-down') void this.split('column', target);
    else if (cmd === 'kill') void this.kill(target);
    else if (cmd === 'zoom') {
      // Zooming a pane focuses it: the button can be clicked on a pane that
      // isn't focused, and typing into one you can no longer see is worse.
      t.layout.toggleZoom(target);
      t.focusedLeafId = target;
      t.layout.focusLeaf(target);
    } else if (cmd === 'config') {
      const p = t.layout.paneIdOf(target);
      if (p) void p.then((paneId) => openConfigEditor(paneId));
    } else if (cmd === 'toggle-favorite') {
      const p = t.layout.paneIdOf(target);
      if (p) {
        void p
          .then((paneId) => window.cerberus.cwd(paneId))
          .then((cwd) => {
            toggleFavorite(cwd);
            // Re-sync every pane's star immediately across all tabs.
            for (const tab of this.tabs) void tab.layout.snapshotCwds();
          })
          .catch(() => {
            /* pane died before cwd resolved */
          });
      }
    } else if (cmd === 'open-favorites') {
      const p = t.layout.paneIdOf(target);
      if (p) {
        void p
          .then((paneId) => {
            openFavoritesOverlay((path) => {
              window.cerberus.write(paneId, `cd ${shellQuote(path)}\r`);
              t.layout.focusLeaf(target);
            });
          })
          .catch(() => {
            /* pane died before it resolved */
          });
      }
    }
  }

  // tmux-style keyboard control, scoped to the active tab.
  handleCerberusAction(action: { type: string; dir?: 'left' | 'right' | 'up' | 'down' }): void {
    const t = this.active();
    if (!t) return;
    const { type, dir } = action;
    const RESIZE_STEP = 0.04;

    if (type === 'zoom') {
      t.layout.toggleZoom(t.focusedLeafId);
    } else if (type === 'split') {
      void this.split(dir === 'down' ? 'column' : 'row', t.focusedLeafId);
    } else if (type === 'kill') {
      void this.kill(t.focusedLeafId);
    } else if (type === 'focus' && dir) {
      const target = t.layout.leafInDirection(t.focusedLeafId, dir);
      if (target) {
        t.focusedLeafId = target;
        t.layout.focusLeaf(target);
      }
    } else if (type === 'resize' && dir) {
      const axis: Dir = dir === 'left' || dir === 'right' ? 'row' : 'column';
      const delta = dir === 'right' || dir === 'down' ? RESIZE_STEP : -RESIZE_STEP;
      t.root = resizeNearest(t.root, t.focusedLeafId, axis, delta);
      t.layout.render(t.root);
      t.layout.focusLeaf(t.focusedLeafId);
      this.schedulePersist();
    }
  }

  // External driver (POST /pane) -> read-only follower pane in the active tab.
  openFollowerPane({ file, title, cwd, format, fmtPath }: OpenPanePayload): void {
    const t = this.active();
    if (!t) return;

    const pick = t.layout.pickTileTarget();
    const parentLeaf = pick?.leafId ?? t.focusedLeafId;
    const dir: Dir = pick?.dir ?? 'row';
    const { root: next, newLeafId } = splitLeaf(t.root, parentLeaf, dir);
    t.root = next;

    const q = shellQuote(file);
    const initialCommand =
      format === 'claude-stream' && fmtPath
        ? `command -v jq >/dev/null 2>&1 && tail -f ${q} | jq -Rr --unbuffered -f ${shellQuote(fmtPath)} || tail -f ${q}\r`
        : `tail -f ${q}\r`;

    t.layout.setPaneSpec(newLeafId, {
      ...(cwd ? { cwd } : {}),
      title: title || `tail:${file.split('/').pop() ?? file}`,
      initialCommand,
      readOnly: true
    });
    this.rerender(t, t.focusedLeafId); // render the follower without stealing focus
  }

  // ---- close confirmation -------------------------------------------------

  private async loadCloseConfirm(): Promise<void> {
    try {
      const s = await window.cerberusSettings.get();
      this.skipCloseConfirm = !!s.skipCloseConfirm;
    } catch {
      /* settings unavailable — keep confirming (the safe default) */
    }
  }

  private confirmClose(kind: 'tab' | 'pane'): Promise<boolean> {
    if (this.skipCloseConfirm) return Promise.resolve(true);
    const msg =
      kind === 'tab'
        ? 'Close this tab? Every running session inside it will be terminated.'
        : 'Close this pane? Its running session will be terminated.';
    return confirmDialog(msg);
  }

  // ---- persistence --------------------------------------------------------

  private schedulePersist(): void {
    if (this.persistTimer !== undefined) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => void this.persistNow(), 800);
  }

  // A reload (or a window close) gives us no chance to await anything, and the
  // periodic snapshot can be up to 4s stale — a pane split moments earlier
  // wouldn't be in it, so on restore its pty would be reaped instead of
  // reattached. Rewrite the snapshot synchronously from the last known cwds
  // plus the live pty ids; a cwd being one cycle old is harmless, losing a pty
  // is not.
  private persistSync(): void {
    const savedTabs: SavedTab[] = this.tabs.map((t) => ({
      id: t.id,
      tree: t.root,
      cwds: t.savedCwds,
      ptys: t.layout.snapshotPtyIdsSync(),
      focusedLeafId: t.focusedLeafId,
      ...(t.customTitle ? { title: t.customTitle } : {})
    }));
    saveWorkspace({ version: 3, tabs: savedTabs, activeTabId: this.activeId });
  }

  private async persistNow(): Promise<void> {
    const savedTabs: SavedTab[] = [];
    for (const t of this.tabs) {
      const cwds = await t.layout.snapshotCwds();
      t.savedCwds = cwds;
      savedTabs.push({
        id: t.id,
        tree: t.root,
        cwds,
        ptys: await t.layout.snapshotPtyIds(),
        focusedLeafId: t.focusedLeafId,
        ...(t.customTitle ? { title: t.customTitle } : {})
      });
    }
    saveWorkspace({ version: 3, tabs: savedTabs, activeTabId: this.activeId });
  }

  // Kill every surviving pty no pane ended up owning. Runs once the restore has
  // settled, so a pane still resolving its attach can't be reaped from under it.
  private async reapOrphanPtys(): Promise<void> {
    try {
      const keep: string[] = [];
      for (const t of this.tabs) keep.push(...Object.values(await t.layout.snapshotPtyIds()));
      await window.cerberus.reap(keep);
    } catch {
      /* best effort — a leftover pty is better than a failed startup */
    }
  }
}
