import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { guardNavigation, isAppDocument } from '../src/main/navigation-guard.js';

const ENTRY = 'file:///Applications/Cerberus.app/Contents/Resources/app.asar/out/renderer/index.html';
const DEV_ENTRY = 'http://localhost:5173/';

describe('isAppDocument', () => {
  it('accepts the entry page itself, with or without query and fragment', () => {
    expect(isAppDocument(ENTRY, ENTRY)).toBe(true);
    expect(isAppDocument(`${ENTRY}#top`, ENTRY)).toBe(true);
    expect(isAppDocument(`${ENTRY}?x=1`, ENTRY)).toBe(true);
    expect(isAppDocument('http://localhost:5173/#x', DEV_ENTRY)).toBe(true);
  });

  it('rejects any other local file', () => {
    expect(isAppDocument('file:///tmp/foreign.html', ENTRY)).toBe(false);
    expect(isAppDocument(ENTRY.replace('index.html', 'other.html'), ENTRY)).toBe(false);
  });

  it('rejects prefix matches on the dev server', () => {
    expect(isAppDocument('http://localhost:5173/evil.html', DEV_ENTRY)).toBe(false);
    expect(isAppDocument('http://localhost:51730/', DEV_ENTRY)).toBe(false);
    expect(isAppDocument('http://localhost:5173@evil.example/', DEV_ENTRY)).toBe(false);
  });

  it('compares percent-encoded and raw paths as the same document', () => {
    const spaced = 'file:///Users/me/My%20Apps/out/renderer/index.html';
    expect(isAppDocument('file:///Users/me/My Apps/out/renderer/index.html', spaced)).toBe(true);
  });

  it('rejects other schemes and garbage', () => {
    expect(isAppDocument('https://example.com/', ENTRY)).toBe(false);
    expect(isAppDocument('mailto:a@b.c', ENTRY)).toBe(false);
    expect(isAppDocument('not a url', ENTRY)).toBe(false);
  });
});

// The handlers are driven in the order Electron 33 emits them: the start of a
// main-frame navigation comes before will-navigate gets to cancel it.
function guarded(entry = ENTRY) {
  const wc = new EventEmitter() as EventEmitter & {
    openHandler?: (d: { url: string }) => { action: string };
  };
  (wc as unknown as { setWindowOpenHandler: unknown }).setWindowOpenHandler = (
    h: (d: { url: string }) => { action: string }
  ) => {
    wc.openHandler = h;
  };
  const hooks = { detach: vi.fn(), openExternal: vi.fn() };
  guardNavigation(wc as unknown as WebContents, entry, hooks);

  // Returns whether the navigation went through.
  const navigate = (url: string): boolean => {
    wc.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false });
    const event = { preventDefault: vi.fn() };
    wc.emit('will-navigate', event, url);
    const allowed = event.preventDefault.mock.calls.length === 0;
    if (allowed) wc.emit('did-navigate', {}, url, 200, 'OK');
    return allowed;
  };
  return { wc, hooks, navigate };
}

describe('guardNavigation', () => {
  it('keeps every pty attached when a link is cancelled and sent to the browser', () => {
    const { hooks, navigate } = guarded();
    expect(navigate('https://github.com/leodudedev/cerberus-term')).toBe(false);
    expect(hooks.openExternal).toHaveBeenCalledWith('https://github.com/leodudedev/cerberus-term');
    expect(hooks.detach).not.toHaveBeenCalled();
  });

  it('keeps every pty attached when a mailto or a dropped file is cancelled', () => {
    const { hooks, navigate } = guarded();
    expect(navigate('mailto:a@b.c')).toBe(false);
    expect(navigate('file:///Users/me/notes.txt')).toBe(false);
    expect(hooks.openExternal).not.toHaveBeenCalled();
    expect(hooks.detach).not.toHaveBeenCalled();
  });

  it('keeps every pty attached on a same-document change', () => {
    const { wc, hooks } = guarded();
    wc.emit('did-start-navigation', { url: `${ENTRY}#x`, isMainFrame: true, isSameDocument: true });
    wc.emit('did-navigate-in-page', {}, `${ENTRY}#x`, true);
    expect(hooks.detach).not.toHaveBeenCalled();
  });

  it('detaches once a new document has replaced the page (reload, crash recovery)', () => {
    const { wc, hooks } = guarded();
    // A reload doesn't go through will-navigate.
    wc.emit('did-start-navigation', { url: ENTRY, isMainFrame: true, isSameDocument: false });
    expect(hooks.detach).not.toHaveBeenCalled();
    wc.emit('did-navigate', {}, ENTRY, 200, 'OK');
    expect(hooks.detach).toHaveBeenCalledOnce();
  });

  it('refuses a foreign local page, so it never gets the preload', () => {
    const { hooks, navigate } = guarded();
    expect(navigate('file:///tmp/foreign.html')).toBe(false);
    expect(navigate(ENTRY)).toBe(true);
    expect(hooks.detach).toHaveBeenCalledOnce();
  });

  it('opens http(s) windows in the browser and denies everything else', () => {
    const { wc, hooks } = guarded();
    expect(wc.openHandler!({ url: 'https://example.com/' })).toEqual({ action: 'deny' });
    expect(wc.openHandler!({ url: 'file:///tmp/foreign.html' })).toEqual({ action: 'deny' });
    expect(wc.openHandler!({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(hooks.openExternal).toHaveBeenCalledOnce();
    expect(hooks.openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('refuses a webview', () => {
    const { wc } = guarded();
    const event = { preventDefault: vi.fn() };
    wc.emit('will-attach-webview', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});
