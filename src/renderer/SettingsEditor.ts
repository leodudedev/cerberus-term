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
  const claudeCmd = textInput(s.launchCmds['claude'] ?? 'claude');
  const copilotCmd = textInput(s.launchCmds['copilot'] ?? 'copilot');

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
    row('Launch: claude', claudeCmd),
    row('Launch: copilot', copilotCmd),
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
      launchCmds: {
        claude: claudeCmd.value.trim() || 'claude',
        copilot: copilotCmd.value.trim() || 'copilot'
      },
      defaultShell: shell.value.trim() || undefined
    };
    const res = await window.cerberusSettings.save(next);
    if (res.ok) close();
    else error.textContent = res.error;
  });
}
