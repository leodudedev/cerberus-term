// In-app confirm modal (reuses the config-modal styling). Native confirm()
// would block the Electron event loop and freeze the extension bridge, so we
// resolve a Promise from a real DOM overlay instead.

let isOpen = false;

export interface ConfirmOptions {
  // Closing a pane destroys a session, so the default action button is red.
  // Reversible choices (a toggle) pass danger:false and get the accent button.
  danger?: boolean;
  // Optional heading above the message, for dialogs that explain rather than
  // just ask. Newlines in `message` are preserved, so it can carry paragraphs.
  title?: string;
}

export function confirmDialog(
  message: string,
  confirmLabel = 'Close',
  opts: ConfirmOptions = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    if (isOpen) {
      resolve(false);
      return;
    }
    isOpen = true;

    const overlay = document.createElement('div');
    overlay.className = 'config-overlay';
    const modal = document.createElement('div');
    modal.className = 'config-modal confirm-modal';

    const msg = document.createElement('div');
    msg.className = 'confirm-message';
    msg.textContent = message;

    const buttons = document.createElement('div');
    buttons.className = 'config-buttons';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'config-cancel';
    cancelBtn.textContent = 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = opts.danger === false ? 'config-save' : 'confirm-danger';
    okBtn.textContent = confirmLabel;
    buttons.append(cancelBtn, okBtn);

    if (opts.title) {
      const h = document.createElement('div');
      h.className = 'settings-title';
      h.textContent = opts.title;
      modal.append(h);
    }
    modal.append(msg, buttons);
    overlay.append(modal);
    document.body.append(overlay);
    okBtn.focus();

    const done = (v: boolean): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      isOpen = false;
      resolve(v);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        done(true);
      }
    };
    // Capture so the shortcut/keymap layer never sees these keys.
    document.addEventListener('keydown', onKey, true);
    cancelBtn.addEventListener('click', () => done(false));
    okBtn.addEventListener('click', () => done(true));
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) done(false);
    });
  });
}
