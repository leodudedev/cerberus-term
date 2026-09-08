import type { Settings, StrayPolicy } from '../core/settings.js';
import { DEFAULT_DOC_GLOBS } from '../core/docs-bridge.js';

// Global settings modal (reuses the config-modal styling). Opened via Cmd+,.

let open = false;

function row(labelText: string, input: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'settings-row';
  const label = document.createElement('span');
  label.className = 'settings-label';
  label.textContent = labelText;
  wrap.append(label, input);
  return wrap;
}

function textInput(value: string, type: 'text' | 'password' = 'text'): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.className = 'settings-input';
  i.value = value;
  i.spellcheck = false;
  return i;
}

export async function openSettingsEditor(): Promise<void> {
  if (open) return;
  open = true;

  const s = await window.cerberusSettings.get();

  const overlay = document.createElement('div');
  overlay.className = 'config-overlay';
  const modal = document.createElement('div');
  modal.className = 'config-modal settings-modal';

  const title = document.createElement('div');
  title.className = 'settings-title';
  title.textContent = 'Settings';

  const token = textInput(s.telegram.token ?? '', 'password');
  const chatId = textInput(s.telegram.chatId ?? '');
  const allowed = textInput(s.telegram.allowedChats ?? '');
  const lang = document.createElement('select');
  lang.className = 'settings-input';
  for (const l of ['en', 'it']) {
    const o = document.createElement('option');
    o.value = l;
    o.textContent = l;
    if ((s.telegram.lang ?? 'en') === l) o.selected = true;
    lang.append(o);
  }
  const shell = textInput(s.defaultShell ?? '');
  shell.placeholder = '$SHELL';
  const skipConfirm = document.createElement('input');
  skipConfirm.type = 'checkbox';
  skipConfirm.className = 'settings-checkbox';
  skipConfirm.checked = s.skipCloseConfirm ?? false;

  // What happens on quit to whatever outlived a pane's pty — a nohup'ed build,
  // a disowned dev server. Labels say what the app does, not the stored value.
  const strays = document.createElement('select');
  strays.className = 'settings-input';
  // Typed as a Record so a policy added to StrayPolicy fails the typecheck
  // here instead of quietly dropping an option. The list is built from these
  // keys rather than imported from core/settings: that module reaches
  // node:path through hook-targets, which a renderer bundle cannot load.
  const STRAY_LABELS: Record<StrayPolicy, string> = {
    ask: 'Ask me',
    terminate: 'Terminate them',
    leave: 'Leave them running'
  };
  for (const policy of Object.keys(STRAY_LABELS) as StrayPolicy[]) {
    const o = document.createElement('option');
    o.value = policy;
    o.textContent = STRAY_LABELS[policy];
    if ((s.strayProcesses ?? 'ask') === policy) o.selected = true;
    strays.append(o);
  }

  // Which paths the pane's document button scans, relative to the project root.
  // Root-level markdown is always listed, so an empty field is a valid answer
  // ("only what's at the top of the project") and not a broken one.
  const docGlobs = textInput((s.docs?.globs ?? []).join(', '));
  docGlobs.placeholder = DEFAULT_DOC_GLOBS.join(', ');

  const docsFullscreen = document.createElement('input');
  docsFullscreen.type = 'checkbox';
  docsFullscreen.className = 'settings-checkbox';
  docsFullscreen.checked = s.docs?.fullscreen === true;

  // On by default, and the viewer's own toolbar button flips it too: unchecking
  // it is what stops a document reaching shields.io and friends.
  const docsRemoteImages = document.createElement('input');
  docsRemoteImages.type = 'checkbox';
  docsRemoteImages.className = 'settings-checkbox';
  docsRemoteImages.checked = s.docs?.remoteImages !== false;

  // One row per agent, each naming the file it writes to and its real state.
  // These live outside the app, in other tools' config — nobody should have to
  // guess which ones we touched, and the list grows as agents are added.
  const hooksTitle = document.createElement('div');
  hooksTitle.className = 'settings-title';
  hooksTitle.textContent = 'Agent CLI hooks';

  const status = await window.cerberusSettings.hooksStatus();
  // Undefined means the consent dialog hasn't been answered yet (it can only be
  // reached before the first window). Mirror its defaults so the two agree.
  const chosen = s.hookTargets ?? status.filter((t) => t.available).map((t) => t.id);

  const hookRows: { id: string; input: HTMLInputElement }[] = [];
  const hooksBlock = document.createDocumentFragment();
  for (const t of status) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'settings-checkbox';
    input.checked = chosen.includes(t.id);
    // Its config folder is gone, so we can't register there — but leave the
    // stored answer alone. Reinstalling that CLI shouldn't silently cost the
    // choice already made about it.
    input.disabled = !t.available;

    const state = !t.available
      ? 'not installed here'
      : t.installed
        ? 'registered'
        : 'not registered';
    // On the same line as the tickbox: the path is the point of the row, and a
    // separate line under it read as a note about the section instead.
    const detail = document.createElement('span');
    detail.className = 'settings-hook-file';
    detail.textContent = `${t.file} — ${state}`;
    detail.title = detail.textContent; // the path is truncated when it has to be

    const cell = document.createElement('div');
    cell.className = 'settings-hook-cell';
    cell.append(input, detail);

    hooksBlock.append(row(t.label, cell));
    hookRows.push({ id: t.id, input });
  }

  const hooksNote = document.createElement('div');
  hooksNote.className = 'settings-hint settings-note';
  hooksNote.textContent =
    'Unchecking removes our entries from that file and leaves every other hook alone.';
  hooksBlock.append(hooksNote);

  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = 'Changing the Telegram token requires an app restart to re-poll.';

  const error = document.createElement('div');
  error.className = 'config-error';

  const buttons = document.createElement('div');
  buttons.className = 'config-buttons';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'config-cancel';
  cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'config-save';
  saveBtn.textContent = 'Save';
  buttons.append(cancelBtn, saveBtn);

  modal.append(
    title,
    row('Telegram bot token', token),
    row('Chat ID', chatId),
    row('Allowed chats (csv)', allowed),
    row('Language', lang),
    row('Default shell', shell),
    row('Skip confirm on close', skipConfirm),
    row('Leftover processes on quit', strays),
    row('Docs folders (csv)', docGlobs),
    row('Open docs full window', docsFullscreen),
    row('Load doc images from the web', docsRemoteImages),
    hooksTitle,
    hooksBlock,
    hint,
    error,
    buttons
  );
  overlay.append(modal);
  document.body.append(overlay);
  token.focus();

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    open = false;
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });
  cancelBtn.addEventListener('click', close);

  saveBtn.addEventListener('click', async () => {
    error.textContent = '';
    const next: Settings = {
      telegram: {
        token: token.value.trim() || undefined,
        chatId: chatId.value.trim() || undefined,
        allowedChats: allowed.value.trim() || undefined,
        lang: lang.value === 'it' ? 'it' : 'en'
      },
      defaultShell: shell.value.trim() || undefined,
      skipCloseConfirm: skipConfirm.checked,
      strayProcesses: strays.value as StrayPolicy,
      docs: {
        // Empty field -> undefined, which is what makes the defaults apply
        // again; an empty *array* would mean "scan nothing but the root".
        globs: docGlobs.value.trim()
          ? docGlobs.value
              .split(/[,\n]/)
              .map((g) => g.trim())
              .filter(Boolean)
          : undefined,
        fullscreen: docsFullscreen.checked,
        remoteImages: docsRemoteImages.checked
      },
      // Disabled rows keep reporting .checked, so an agent that's currently
      // uninstalled carries its stored answer through untouched.
      hookTargets: hookRows.filter((r) => r.input.checked).map((r) => r.id) as Settings['hookTargets']
    };
    const res = await window.cerberusSettings.save(next);
    if (res.ok) {
      // Let live components (Workspace close-confirm gate) pick up the change.
      window.dispatchEvent(new CustomEvent('settings-changed'));
      close();
    } else error.textContent = res.error;
  });
}
