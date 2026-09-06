import { SHORTCUT_GROUPS } from './shortcuts.js';

// Read-only cheat sheet for every binding (tab bar "?" button, Ctrl+B ?, or
// Help -> Keyboard Shortcuts). Reuses the config/settings modal chrome; there's
// nothing to save, so it closes on Esc, backdrop, or the one button.

let open = false;

export function openShortcutsOverlay(): void {
  if (open) return;
  open = true;

  const overlay = document.createElement('div');
  overlay.className = 'config-overlay';
  const modal = document.createElement('div');
  modal.className = 'config-modal settings-modal shortcuts-modal';

  const title = document.createElement('div');
  title.className = 'settings-title';
  title.textContent = 'Keyboard shortcuts';

  const list = document.createElement('div');
  list.className = 'shortcuts-list';

  for (const group of SHORTCUT_GROUPS) {
    if (group.items.length === 0) continue; // platform-only group, nothing to show

    const groupTitle = document.createElement('div');
    groupTitle.className = 'shortcuts-group';
    groupTitle.textContent = group.title;
    list.append(groupTitle);

    if (group.hint) {
      const hint = document.createElement('div');
      hint.className = 'settings-hint';
      hint.textContent = group.hint;
      list.append(hint);
    }

    for (const item of group.items) {
      const row = document.createElement('div');
      row.className = 'shortcuts-row';

      const keys = document.createElement('kbd');
      keys.className = 'shortcuts-keys';
      keys.textContent = item.keys;

      const label = document.createElement('span');
      label.className = 'shortcuts-label';
      label.textContent = item.label;

      row.append(keys, label);
      list.append(row);
    }
  }

  const buttons = document.createElement('div');
  buttons.className = 'config-buttons';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'config-cancel';
  closeBtn.textContent = 'Close';
  buttons.append(closeBtn);

  modal.append(title, list, buttons);
  overlay.append(modal);
  document.body.append(overlay);
  closeBtn.focus();

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
  closeBtn.addEventListener('click', close);
}
