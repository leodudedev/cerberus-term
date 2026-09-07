import {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type MenuItemConstructorOptions
} from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerBridge, killAllPtys, detachAllPtys, ptyShellPids } from './bridge-electron.js';
import {
  snapshotPaneProcesses,
  stillRunning,
  terminate,
  HANGUP_GRACE_MS,
  type Stray
} from './stray-processes.js';
import { getSettings, saveSettings } from './settings.js';
import type { StrayPolicy } from '../core/settings.js';
import { registerConfigIpc } from './config-ipc.js';
import { registerSettingsIpc } from './settings-ipc.js';
import { registerMuteIpc } from './mute-ipc.js';
import { initAttention, clearAttention } from './attention.js';
import { startCerberus } from './cerberus/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

const isDev = Boolean(process.env['ELECTRON_RENDERER_URL']);

// A native menu is the only reliable way to bind Cmd+, on macOS (the OS routes
// it to the app menu before the web page ever sees the keydown). Zoom roles are
// deliberately omitted so the terminal UI can't be zoomed.
function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const openSettings = (): void => mainWindow?.webContents.send('cerberus:open-settings');
  const toggleTheme = (): void => mainWindow?.webContents.send('cerberus:toggle-theme');
  const openShortcuts = (): void => mainWindow?.webContents.send('cerberus:open-shortcuts');
  const tab = (action: string): void => mainWindow?.webContents.send('cerberus:tab', action);
  // Clipboard can't go through role:'copy'/'paste': with the WebGL renderer a
  // terminal selection is drawn by xterm, not a DOM selection, so Chromium's
  // editing command has nothing to act on. Route the action to the renderer,
  // which knows whether a terminal or a settings input has focus; the paste text
  // is read here so the renderer never needs the clipboard-read permission.
  const edit = (action: 'copy' | 'paste' | 'find'): void =>
    mainWindow?.webContents.send(
      'cerberus:edit',
      action,
      action === 'paste' ? clipboard.readText() : undefined
    );

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: openSettings },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } as MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'Edit',
      submenu: isMac
        ? [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { label: 'Copy', accelerator: 'Cmd+C', click: () => edit('copy') },
            { label: 'Paste', accelerator: 'Cmd+V', click: () => edit('paste') },
            { role: 'selectAll' },
            { type: 'separator' },
            { label: 'Find…', accelerator: 'Cmd+F', click: () => edit('find') }
          ]
        : // Ctrl+C/X/Z/A are control characters the shell owns (SIGINT, the
          // emacs prefix, SIGTSTP, beginning-of-line): a menu accelerator on any
          // of them takes the key before the pty ever sees it. Only the
          // Ctrl+Shift pair every Linux terminal uses.
          [
            // Ctrl+F is forward-char in emacs-mode readline, so Find takes the
            // same Ctrl+Shift seat as the clipboard items.
            { label: 'Copy', accelerator: 'Ctrl+Shift+C', click: () => edit('copy') },
            { label: 'Paste', accelerator: 'Ctrl+Shift+V', click: () => edit('paste') },
            { type: 'separator' },
            { label: 'Find…', accelerator: 'Ctrl+Shift+F', click: () => edit('find') }
          ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Theme', accelerator: 'CmdOrCtrl+Shift+L', click: toggleTheme },
        { type: 'separator' },
        // Dev only. Not because reload is dangerous any more — panes reattach
        // to their ptys now, so it's a repaint — but because the role carries a
        // CmdOrCtrl+R accelerator, and Ctrl+R is the shell's reverse-i-search.
        // A menu item is the only thing binding that key, so leaving it out of
        // the production menu is what keeps the key free. Crash recovery
        // doesn't go through here: it calls webContents.reload() directly.
        ...(isDev ? [{ role: 'reload' } as MenuItemConstructorOptions] : []),
        // Dev only too: the menu item is the only thing that opens the devtools
        // and the only thing binding CmdOrCtrl+Shift+I, so leaving it out of the
        // production menu takes both away.
        ...(isDev ? [{ role: 'toggleDevTools' } as MenuItemConstructorOptions] : []),
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Tab',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => tab('new') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => tab('close') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Shift+]', click: () => tab('next') },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', click: () => tab('prev') }
      ]
    },
    // Custom Window submenu instead of role:'windowMenu' so Cmd+W is free for
    // Close Tab; the window closes on Cmd+Shift+W (or when the last tab closes).
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close', accelerator: 'CmdOrCtrl+Shift+W', label: 'Close Window' }
      ]
    },
    ...(!isMac
      ? [
          {
            label: 'File',
            submenu: [
              { label: 'Settings…', accelerator: 'Ctrl+,', click: openSettings },
              { type: 'separator' },
              { role: 'about' },
              { role: 'quit' } // Ctrl+Q, the expected quit on Windows/Linux
            ]
          } as MenuItemConstructorOptions
        ]
      : []),
    {
      // role:'help' so macOS files it under the standard Help menu (and gets its
      // search field). Ctrl+/ is readline's undo, so off macOS the accelerator
      // moves to Ctrl+Shift+/ like the other shell-owned keys.
      role: 'help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: isMac ? 'Cmd+/' : 'Ctrl+Shift+/',
          click: openShortcuts
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Cerberus',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox off: preload needs Node to reach the main-side bridge over IPC.
      // node-pty itself lives only in main, never in the renderer.
      sandbox: false
    }
  });

  // Block browser zoom accelerators (Cmd/Ctrl +/-/0): a terminal must not
  // zoom the whole UI. Doing it here also beats the default menu accelerators,
  // which a renderer preventDefault can't stop.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    if (!mod) return;
    if (input.key === ',') {
      // Reliable Cmd/Ctrl+, even if the menu accelerator doesn't fire.
      event.preventDefault();
      mainWindow?.webContents.send('cerberus:open-settings');
      return;
    }
    // Cmd/Ctrl+1..9 -> jump to tab N (9 items would clutter the menu, so this
    // stays a keyboard-only binding routed straight to the renderer).
    if (!input.shift && !input.alt && /^[1-9]$/.test(input.key)) {
      event.preventDefault();
      mainWindow?.webContents.send('cerberus:tab', 'select', Number(input.key) - 1);
      return;
    }
    // Block browser zoom only on macOS (Cmd+±/0). On Windows/Linux those are
    // Ctrl+± which the shell and TUIs use (readline, emacs C-_/C-0…), so leave
    // them to the terminal — the app menu carries no zoom roles anyway.
    if (process.platform === 'darwin' && ['=', '+', '-', '0'].includes(input.key)) {
      event.preventDefault();
    }
  });

  // The preload hands this window spawn/write/kill over the ptys, so letting any
  // other document load here would hand a page arbitrary command execution.
  // contextIsolation doesn't help with that — it protects the bridge, not which
  // origin gets to hold it. Keep navigation pinned to our own renderer and push
  // every link out to the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  // No <webview> anywhere in the app; anything trying to attach one is a bug or
  // an injection.
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  // The ptys live in main and outlive the page. Whenever the renderer restarts
  // — reload, crash, dev HMR — orphan them so their output is buffered until
  // the fresh renderer reattaches, instead of being fired at a dead frame.
  mainWindow.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame) detachAllPtys();
  });

  // A crashed renderer would otherwise sit on the "Aw, snap" page with every
  // shell still alive but unreachable. Reload it: the restore reattaches the
  // surviving ptys and the sessions come back. Rate-limited, so a page that
  // crashes on load can't spin here forever.
  let lastCrashReload = 0;
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || details.reason === 'killed') return;
    const now = Date.now();
    if (now - lastCrashReload < 10_000) {
      console.error('[main] renderer crashed again (%s) — not reloading', details.reason);
      return;
    }
    lastCrashReload = now;
    console.error('[main] renderer gone (%s) — reloading to reattach', details.reason);
    mainWindow?.webContents.reload();
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  // The user got the message: stop the taskbar flash raised for a permission
  // request (a no-op on macOS, where the dock bounce ends with the activation).
  mainWindow.on('focus', clearAttention);
  mainWindow.on('closed', () => {
    // The renderer is gone but the ptys live in main: without this they'd keep
    // running headless (a `claude` inside one would even keep notifying).
    // Record the shells first: on macOS the app outlives the window, so this
    // can be the last moment their session ids are readable.
    rememberPaneProcesses();
    killAllPtys();
    mainWindow = null;
  });

  // electron-vite injects the dev server URL; production loads the built HTML.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerBridge(() => mainWindow);
  registerConfigIpc();
  registerSettingsIpc();
  registerMuteIpc(() => mainWindow);
  initAttention(() => mainWindow);
  // Renderer asks to close the window after the last tab is closed.
  ipcMain.on('cerberus:close-window', () => mainWindow?.close());
  // No terminal claimed the Edit action (focus is in the settings modal, or
  // there was no selection to copy) — hand it back to Chromium's native path.
  ipcMain.on('cerberus:edit-fallback', (_e, action: 'copy' | 'paste') => {
    const wc = mainWindow?.webContents;
    if (!wc) return;
    if (action === 'copy') wc.copy();
    else wc.paste();
  });
  buildMenu();
  createWindow();

  // Cerberus remote control (daemon + Telegram bot). Never let it crash the app.
  try {
    startCerberus(() => mainWindow);
  } catch (e) {
    console.error('[cerberus] failed to start:', (e as Error).message);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// What was running under the panes the last time we could still see it. The
// parent chain only leads to these processes while their shell is alive, so
// every kill site takes the snapshot first — including the window-close path,
// which on macOS can be the last look before the app idles in the dock.
let paneProcesses: Stray[] = [];

function rememberPaneProcesses(): void {
  const seen = new Set(paneProcesses.map((s) => s.pid));
  for (const s of snapshotPaneProcesses(ptyShellPids())) {
    if (!seen.has(s.pid)) paneProcesses.push(s);
  }
}

// What outlived the panes, and what to do about it. Runs after the ptys are
// already dead, so there is no "cancel": the question is only whether these
// processes stay up once the app is gone. See main/stray-processes.ts.
async function handleStrays(policy: StrayPolicy): Promise<void> {
  await new Promise((r) => setTimeout(r, HANGUP_GRACE_MS));
  // Whatever the hangup was going to take down is gone by now; the rest chose
  // to stay.
  const strays = stillRunning(paneProcesses);
  if (strays.length === 0) return;

  if (policy === 'terminate') {
    await terminate(strays);
    return;
  }

  const list = strays.map((s) => `  ${s.label}  (pid ${s.pid})`).join('\n');
  const one = strays.length === 1;
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'question',
    // A detached process is the user's own doing — leaving it alone is the
    // conservative answer, so it's the default one.
    buttons: ['Leave running', 'Terminate'],
    defaultId: 0,
    cancelId: 0,
    message: one
      ? 'One process is still running outside its pane'
      : `${strays.length} processes are still running outside their panes`,
    detail: `${list}\n\nClosing Cerberus won't stop ${one ? 'it' : 'them'}.`,
    checkboxLabel: 'Always do this',
    checkboxChecked: false
  });

  const chosen: StrayPolicy = response === 1 ? 'terminate' : 'leave';
  if (checkboxChecked) saveSettings({ ...getSettings(), strayProcesses: chosen });
  if (chosen === 'terminate') await terminate(strays);
}

// Set once the stray question has been answered (or skipped): app.quit() below
// re-enters this handler, and the second pass must let the quit through.
let strayCheckDone = false;

app.on('before-quit', (e) => {
  rememberPaneProcesses();
  killAllPtys();
  if (strayCheckDone) return;

  const policy = getSettings().strayProcesses ?? 'ask';
  if (policy === 'leave') return;

  // The scan and the dialog are both async, and nothing in Electron's quit
  // sequence waits: hold the quit here and re-issue it once we have an answer.
  e.preventDefault();
  void handleStrays(policy).finally(() => {
    strayCheckDone = true;
    app.quit();
  });
});
