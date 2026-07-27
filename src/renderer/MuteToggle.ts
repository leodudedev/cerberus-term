// Global do-not-disturb toggle, parked at the right edge of the tab bar.
// One click silences the Telegram push for every session (you're at the
// keyboard); one more restores them all (you walked away). The flag lives in
// main, so the state survives a reload and applies to every project at once.

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

  const paint = (): void => {
    btn.title = muted
      ? 'Telegram notifications OFF for every session — click to re-enable'
      : 'Telegram notifications ON — click to silence every session';
    btn.classList.toggle('muted', muted);
    btn.setAttribute('aria-pressed', String(muted));
    // Icon-only button: the label is the only thing a screen reader gets.
    btn.setAttribute('aria-label', 'Telegram notifications');
  };

  paint();

  // Initial state from main. A failure leaves the plane showing "on", which is
  // the honest default: the daemon only mutes when it knows the flag is set.
  void window.cerberusMute
    .getAll()
    .then((on) => {
      muted = on;
      paint();
    })
    .catch(() => {
      /* bridge unavailable — keep the default */
    });

  // Flipped from elsewhere (a future remote command): follow along.
  window.cerberusMute.onChange((active) => {
    muted = active;
    paint();
  });

  btn.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    const next = !muted;
    void window.cerberusMute
      .setAll(next)
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
