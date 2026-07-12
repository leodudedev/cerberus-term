// Thin per-pane header: title left, operation buttons right. Buttons dispatch
// the same 'pane-cmd' window event as the temp keymap, tagged with this pane's
// leafId so they act on their own pane regardless of focus.

type PaneCmd = 'split-right' | 'split-down' | 'kill' | 'config';

function emit(cmd: PaneCmd, leafId: string): void {
  window.dispatchEvent(new CustomEvent('pane-cmd', { detail: { cmd, leafId } }));
}

function button(glyph: string, title: string, cmd: PaneCmd, leafId: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'pane-btn';
  b.type = 'button';
  b.textContent = glyph;
  b.title = title;
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    emit(cmd, leafId);
  });
  return b;
}

export function makePaneHeader(leafId: string, focus: () => void): HTMLElement {
  const header = document.createElement('div');
  header.className = 'pane-header';

  const title = document.createElement('span');
  title.className = 'pane-title';
  title.textContent = 'terminal';

  const buttons = document.createElement('div');
  buttons.className = 'pane-buttons';
  buttons.append(
    button('◧', 'Split right', 'split-right', leafId),
    button('⬓', 'Split down', 'split-down', leafId),
    button('✕', 'Close pane', 'kill', leafId)
  );

  const gear = button('⚙', 'Config (coming in Step 5)', 'config', leafId);
  gear.classList.add('pane-btn-gear');
  buttons.append(gear);

  header.append(title, buttons);

  // Clicking header background (not a button) focuses the pane.
  header.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    focus();
  });

  return header;
}
