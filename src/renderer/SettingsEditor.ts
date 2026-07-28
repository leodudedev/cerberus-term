import type { Settings } from '../core/settings.js';

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

  const agentHooks = document.createElement('input');
  agentHooks.type = 'checkbox';
  agentHooks.className = 'settings-checkbox';
  agentHooks.checked = s.agentHooks !== false;

  // Name every file the checkbox writes to, and its real state. These live
  // outside the app, in other tools' config — nobody should have to guess which
  // ones we touched, and the list grows as agents are added.
  const hooksHint = document.createElement('div');
  hooksHint.className = 'settings-hint';
  for (const t of await window.cerberusSettings.hooksStatus()) {
    const line = document.createElement('div');
    const state = !t.available
      ? 'not installed here — skipped'
      : t.installed
        ? 'registered'
        : 'not registered yet';
    line.textContent = `${t.label}: ${t.file} — ${state}`;
    hooksHint.append(line);
  }
  const hooksNote = document.createElement('div');
  hooksNote.textContent =
    'Only agents whose config folder already exists are touched; unchecking removes our entries and leaves every other hook alone.';
  hooksHint.append(hooksNote);

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
    row('Register agent CLI hooks', agentHooks),
    hooksHint,
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
      agentHooks: agentHooks.checked
    };
    const res = await window.cerberusSettings.save(next);
    if (res.ok) {
      // Let live components (Workspace close-confirm gate) pick up the change.
      window.dispatchEvent(new CustomEvent('settings-changed'));
      close();
    } else error.textContent = res.error;
  });
}
