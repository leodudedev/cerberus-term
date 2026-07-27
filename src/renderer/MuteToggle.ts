// Global do-not-disturb toggle, parked at the right edge of the tab bar.
// One click silences the Telegram push for every session (you're at the
// keyboard); one more restores them all (you walked away). The flag lives in
// main, so the state survives a reload and applies to every project at once.

import { confirmDialog } from './ConfirmDialog.js';

// Telegram's paper plane, inline so it inherits currentColor and needs no
// network fetch (the CSP forbids one anyway). The slash is part of the same
// drawing: its backing stroke is painted in the bar's own colour so the cut
// reads as a gap in the plane rather than a line on top of it.
const PLANE_SVG = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M23.91 3.79 20.3 20.84c-.25 1.21-.98 1.5-2 .94l-5.5-4.07-2.66 2.57c-.3.3-.55.56-1.1.56-.72 0-.6-.27-.84-.95L6.3 13.7l-5.45-1.7c-1.18-.35-1.19-1.16.26-1.75l21.26-8.2c.97-.43 1.9.24 1.53 1.73Z"/>
  <line class="mute-slash-bg" x1="3.5" y1="20.5" x2="20.5" y2="3.5"/>
  <line class="mute-slash" x1="3.5" y1="20.5" x2="20.5" y2="3.5"/>
</svg>`;

export function makeMuteToggle(): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tabbar-btn tabbar-telegram';
  // Static markup, no interpolation — nothing user-supplied reaches the DOM.
  btn.innerHTML = PLANE_SVG;

  let muted = false;
  let busy = false;
  // Without a bot token + chat id nothing pushes anywhere, so a live switch
  // would promise a silence it isn't causing. Stay visible but inert, and say
  // why — hiding it would just make the feature invisible to whoever hasn't
  // set Telegram up yet.
  let configured = true;

  const paint = (): void => {
    btn.disabled = !configured;
    btn.classList.toggle('unconfigured', !configured);
    btn.title = !configured
      ? 'Telegram not configured — add a bot token and chat ID in Settings (Cmd+,)'
      : muted
        ? 'Telegram notifications OFF for every session — click to re-enable'
        : 'Telegram notifications ON — click to silence every session';
    btn.classList.toggle('muted', muted && configured);
    btn.setAttribute('aria-pressed', String(muted && configured));
    // Icon-only button: the label is the only thing a screen reader gets.
    btn.setAttribute('aria-label', 'Telegram notifications');
  };

  paint();

  // Initial state from main. A failure leaves the plane showing "on", which is
  // the honest default: the daemon only mutes when it knows the flag is set.
  const refresh = (): void => {
    void window.cerberusMute
      .getAll()
      .then((on) => {
        muted = on;
        paint();
      })
      .catch(() => {
        /* bridge unavailable — keep the default */
      });
    void window.cerberusMute
      .configured()
      .then((ok) => {
        configured = ok;
        paint();
      })
      .catch(() => {
        /* assume configured rather than disable a working toggle */
      });
  };

  refresh();

  // Credentials can arrive (or leave) while the app is up: Settings saves and
  // fires this, no restart needed for the button to catch up.
  window.addEventListener('settings-changed', refresh);

  // Flipped from elsewhere (a future remote command): follow along.
  window.cerberusMute.onChange((active) => {
    muted = active;
    paint();
  });

  // An icon alone can't say what a global switch does, and getting it backwards
  // is expensive in both directions: silence you didn't want, or a phone that
  // stays quiet while a session waits for you. So the click opens a dialog that
  // spells out what changes — and, just as importantly, what doesn't.
  const confirmFlip = (next: boolean): Promise<boolean> =>
    next
      ? confirmDialog(
          'No session will notify Telegram until you turn this back on.\n\n' +
            'Permission prompts and idle notices still show up here: the pane ' +
            'flashes and its tab blinks, exactly as now. Only the phone goes quiet.\n\n' +
            'Projects you muted individually stay muted when you switch this back on.',
          'Silence Telegram',
          { danger: false, title: 'Silence Telegram for every session?' }
        )
      : confirmDialog(
          'Every session goes back to pushing permission prompts and ' +
            'notifications to your phone, with the approve/deny buttons.\n\n' +
            'Projects muted individually (/mute from the chat, or "mute" in ' +
            'their .cerberus.json) stay muted — this only lifts the global switch.',
          'Re-enable Telegram',
          { danger: false, title: 'Re-enable Telegram for every session?' }
        );

  btn.addEventListener('click', () => {
    if (busy || !configured) return;
    busy = true;
    const next = !muted;
    void confirmFlip(next)
      .then((ok) => (ok ? window.cerberusMute.setAll(next) : muted))
      .then((state) => {
        muted = state;
        paint();
      })
      .catch(() => {
        /* keep the last known state */
      })
      .finally(() => {
        busy = false;
      });
  });

  return btn;
}
