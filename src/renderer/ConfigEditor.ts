// In-app `.cerberus.json` editor: a modal with the JSON in a textarea, the
// target path, and Save/Cancel. One modal at a time.

let open = false;

export async function openConfigEditor(paneId: string): Promise<void> {
  if (open) return;
  open = true;

  const target = await window.cerberusConfig.resolve(paneId);

  const overlay = document.createElement('div');
  overlay.className = 'config-overlay';

  const modal = document.createElement('div');
  modal.className = 'config-modal';

  const pathLabel = document.createElement('div');
  pathLabel.className = 'config-path';
  pathLabel.textContent = target.path + (target.exists ? '' : '  (new)');

  const textarea = document.createElement('textarea');
  textarea.className = 'config-textarea';
  textarea.value = target.content;
  textarea.spellcheck = false;

  const error = document.createElement('div');
  error.className = 'config-error';

  const buttons = document.createElement('div');
  buttons.className = 'config-buttons';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'config-cancel';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save';
  saveBtn.className = 'config-save';
  buttons.append(cancelBtn, saveBtn);

  modal.append(pathLabel, textarea, error, buttons);
  overlay.append(modal);
  document.body.append(overlay);
  textarea.focus();

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

  // clicking the backdrop (not the modal) cancels
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });

  cancelBtn.addEventListener('click', close);

  saveBtn.addEventListener('click', async () => {
    error.textContent = '';
    const res = await window.cerberusConfig.save(target.path, textarea.value);
    if (res.ok) {
      close();
    } else {
      error.textContent = res.error;
    }
  });
}
