// Right-click menu for a pane's terminal area. Mirrors the pane header
// buttons (favorites/close) so they're reachable without moving the mouse up
// to the header, plus a local "Clear Terminal". Favorites/close dispatch the
// same 'pane-cmd' window event PaneHeader uses, so Workspace.handlePaneCmd
// stays the one place that actually runs them (including the kill confirm).

function emit(cmd: 'kill' | 'toggle-favorite' | 'open-favorites', leafId: string): void {
  window.dispatchEvent(new CustomEvent('pane-cmd', { detail: { cmd, leafId } }));
}

export interface PaneContextMenuOptions {
  leafId: string;
  // Follower/read-only panes have no live shell to cd, so PaneHeader hides
  // their star/heart buttons — mirror that here too.
  showFavorites: boolean;
  isFavorite: boolean;
  clearScreen(): void;
}

let closeOpen: (() => void) | null = null;

export function openPaneContextMenu(x: number, y: number, opts: PaneContextMenuOptions): void {
  closeOpen?.(); // only one menu open at a time

  const menu = document.createElement('div');
  menu.className = 'context-menu';

  const close = (): void => {
    menu.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    closeOpen = null;
  };
  closeOpen = close;

  const onOutside = (e: PointerEvent): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };

  const item = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'context-menu-item';
    b.textContent = label;
    b.addEventListener('click', () => {
      onClick();
      close();
    });
    return b;
  };
  const sep = (): HTMLElement => {
    const d = document.createElement('div');
    d.className = 'context-menu-sep';
    return d;
  };

  menu.append(item('Clear Terminal', opts.clearScreen));

  if (opts.showFavorites) {
    menu.append(
      sep(),
      item(opts.isFavorite ? 'Remove from Favorites' : 'Add to Favorites', () =>
        emit('toggle-favorite', opts.leafId)
      ),
      item('Switch to Favorite…', () => emit('open-favorites', opts.leafId))
    );
  }

  menu.append(sep(), item('Close Pane', () => emit('kill', opts.leafId)));

  document.body.append(menu);
  // Clamp inside the viewport so a right-click near an edge doesn't spill off-screen.
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;

  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
}
