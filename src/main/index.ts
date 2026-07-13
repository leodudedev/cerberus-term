import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerBridge, killAllPtys } from './bridge-electron.js';
import { registerConfigIpc } from './config-ipc.js';
import { registerSettingsIpc } from './settings-ipc.js';
import { startCerberus } from './cerberus/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

// A native menu is the only reliable way to bind Cmd+, on macOS (the OS routes
// it to the app menu before the web page ever sees the keydown). Zoom roles are
// deliberately omitted so the terminal UI can't be zoomed.
function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const openSettings = (): void => mainWindow?.webContents.send('cerberus:open-settings');
  const toggleTheme = (): void => mainWindow?.webContents.send('cerberus:toggle-theme');

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
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Theme', accelerator: 'CmdOrCtrl+Shift+L', click: toggleTheme },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    ...(!isMac
      ? [
          {
            label: 'Settings',
            submenu: [{ label: 'Settings…', accelerator: 'Ctrl+,', click: openSettings }]
          } as MenuItemConstructorOptions
        ]
      : [])
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
    if (['=', '+', '-', '0'].includes(input.key)) {
      event.preventDefault();
    } else if (input.key === ',') {
      // Reliable Cmd+, even if the menu accelerator doesn't fire.
      event.preventDefault();
      mainWindow?.webContents.send('cerberus:open-settings');
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
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
  buildMenu();
  createWindow();

  // Cerberus remote control (daemon + Telegram bot). Never let it crash the app.
  try {
    startCerberus();
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

app.on('before-quit', () => {
  killAllPtys();
});
