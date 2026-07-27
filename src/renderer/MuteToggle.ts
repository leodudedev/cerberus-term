// Global do-not-disturb toggle, parked at the right edge of the tab bar.
// One click silences the Telegram push for every session (you're at the
// keyboard); one more restores them all (you walked away). The flag lives in
// main, so the state survives a reload and applies to every project at once.

export function makeMuteToggle(): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tabbar-btn';

  let muted = false;
  let busy = false;

  const paint = (): void => {
    btn.textContent = muted ? '🔕' : '🔔';
    btn.title = muted
      ? 'Telegram notifications OFF for every session — click to re-enable'
      : 'Telegram notifications ON — click to silence every session';
    btn.classList.toggle('muted', muted);
    btn.setAttribute('aria-pressed', String(muted));
  };

  paint();

  // Initial state from main. A failure leaves the bell showing "on", which is
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
