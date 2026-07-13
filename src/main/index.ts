import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerBridge, killAllPtys } from './bridge-electron.js';
import { registerConfigIpc } from './config-ipc.js';
import { registerSettingsIpc } from './settings-ipc.js';
import { startCerberus } from './cerberus/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

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
    if (mod && ['=', '+', '-', '0'].includes(input.key)) event.preventDefault();
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
