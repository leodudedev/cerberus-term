import type { WebContents } from 'electron';

// Whether `url` loads the renderer's own page: same scheme, host and path as
// `entry`. Query and fragment are ignored — they don't change which document
// ends up holding the preload. Anything else (another local file, a sibling
// path on the dev server, a prefix match) is a different document.
export function isAppDocument(url: string, entry: string): boolean {
  try {
    const u = new URL(url);
    const e = new URL(entry);
    return u.protocol === e.protocol && u.host === e.host && u.pathname === e.pathname;
  } catch {
    return false;
  }
}

export interface NavigationHooks {
  // Every pty loses its owner: a new document has replaced the page.
  detach: () => void;
  openExternal: (url: string) => void;
}

// Pins `wc` to the renderer at `entry` and ties pty ownership to the document
// actually on screen.
//
// The preload hands this window spawn/write/kill over the ptys, so letting any
// other document load here would hand that page arbitrary command execution.
// contextIsolation doesn't help with that — it protects the bridge, not which
// document gets to hold it. A page's CSP doesn't follow it to the next one
// either. So only the entry page itself may load; every link goes out to the
// OS browser.
//
// Ownership moves on did-navigate, never on did-start-navigation: the start
// fires before will-navigate gets to cancel, so a cancelled navigation (a link
// sent to the browser, a drop) would leave the old page alive with every pane
// detached — input still reaching the shells, output no longer shown.
// did-navigate fires only once a new main-frame document has committed
// (reload, crash recovery, dev full reload), and never for same-document
// changes (hash, pushState). Output in flight meanwhile isn't lost: the
// rolling buffer keeps it and the reattach replays it.
export function guardNavigation(wc: WebContents, entry: string, hooks: NavigationHooks): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) hooks.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (isAppDocument(url, entry)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) hooks.openExternal(url);
  });
  wc.on('did-navigate', () => hooks.detach());
  // No <webview> anywhere in the app; anything trying to attach one is a bug or
  // an injection.
  wc.on('will-attach-webview', (event) => event.preventDefault());
}
