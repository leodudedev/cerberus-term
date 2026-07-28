import type { HookTargetStatus } from '../core/settings.js';

// First-run consent for the one thing Cerberus does outside its own files:
// registering notification hooks in other tools' config. It names every file,
// event and command up front rather than reporting them afterwards.
//
// Deliberately not dismissible with Escape or a click outside. Those record no
// answer, which leaves only two bad options — ask again on every launch, or
// read the silence as a yes. Two buttons cost one click and remove the
// ambiguity. Resolves with the ids to enable; an empty array is a real "no",
// and is stored as one so we never ask twice.

let isOpen = false;

function line(text: string): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  return el;
}

export function openHooksConsent(targets: HookTargetStatus[]): Promise<string[]> {
  return new Promise((resolve) => {
    if (isOpen || targets.length === 0) {
      resolve([]);
      return;
    }
    isOpen = true;

    const overlay = document.createElement('div');
    overlay.className = 'config-overlay';
    const modal = document.createElement('div');
    modal.className = 'config-modal settings-modal';

    const title = document.createElement('div');
    title.className = 'settings-title';
    title.textContent = 'Register hooks in your agent CLIs?';

    const intro = document.createElement('div');
    intro.className = 'confirm-message';
    intro.textContent =
      'Cerberus can register notification hooks in the agent CLIs it found on this machine. ' +
      'They make a pane flash when its session asks for a permission, and — if you set up the ' +
      'Telegram bot — forward that prompt to your phone.';

    // One row per agent, each carrying the file it would edit. Checked by
    // default: these are the CLIs actually installed here, and the whole point
    // of the app is that they report back.
    const boxes = targets.map((t) => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'settings-checkbox';
      input.checked = true;

      const row = document.createElement('label');
      row.className = 'settings-row';
      const label = document.createElement('span');
      label.className = 'settings-label';
      label.textContent = t.label;
      row.append(input, label);

      const detail = document.createElement('div');
      detail.className = 'settings-hint';
      detail.append(
        line(t.file),
        line(`${t.events.length} entries, under ${t.events.join(', ')}, running ${t.command}`)
      );

      modal.append(row, detail);
      return { id: t.id as string, input };
    });

    const terms = document.createElement('div');
    terms.className = 'settings-hint';
    terms.append(
      line(
        'The original file is copied to settings.json.cerberus-bak once, before the first change.'
      ),
      line('Hooks belonging to anything else are never read, moved or removed.'),
      line('Config folders that do not exist are never created.'),
      line('You can change this any time in Settings, which removes our entries again.')
    );

    const buttons = document.createElement('div');
    buttons.className = 'config-buttons';
    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'config-cancel';
    skipBtn.textContent = 'Not now';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'config-save';
    okBtn.textContent = 'Enable selected';
    buttons.append(skipBtn, okBtn);

    modal.prepend(title, intro);
    modal.append(terms, buttons);
    overlay.append(modal);
    document.body.append(overlay);
    okBtn.focus();

    const done = (ids: string[]): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      isOpen = false;
      resolve(ids);
    };
    // Swallow Escape rather than let the keymap layer act on it behind a modal
    // that isn't going anywhere.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey, true);
    skipBtn.addEventListener('click', () => done([]));
    okBtn.addEventListener('click', () =>
      done(boxes.filter((b) => b.input.checked).map((b) => b.id))
    );
  });
}
