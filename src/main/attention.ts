import { app, type BrowserWindow } from 'electron';

// OS-level "look at me" when a permission prompt lands while the user is
// somewhere else: dock bounce on macOS, taskbar flash on Windows/Linux.
// Deliberately NOT gated by mute — mute silences the phone, not the machine
// sitting in front of you.

let getWindow: () => BrowserWindow | null = () => null;
// macOS clears the bounce itself once the app is activated; flashFrame does
// not, so the flash has to be turned off by hand on focus.
let flashing = false;

export function initAttention(get: () => BrowserWindow | null): void {
  getWindow = get;
}

export function requestAttention(): void {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  // The window is already on screen with focus: the pane flash in the renderer
  // is the whole signal needed, and macOS ignores a bounce for the front app.
  if (win.isFocused() && !win.isMinimized()) return;

  if (process.platform === 'darwin') {
    // 'critical' bounces until the app is activated; 'informational' stops
    // after a second, which is exactly the second you're not looking.
    app.dock.bounce('critical');
    return;
  }
  // Windows taskbar button, Linux urgency hint (honoured by most WMs).
  win.flashFrame(true);
  flashing = true;
}

export function clearAttention(): void {
  if (!flashing) return;
  flashing = false;
  const win = getWindow();
  if (win && !win.isDestroyed()) win.flashFrame(false);
}
