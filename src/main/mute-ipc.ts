import { ipcMain, type BrowserWindow } from 'electron';
import { isMutedAll, setMutedAll, onMuteAllChange } from '../core/mute.js';
import { telegramConfigured } from './settings.js';
import { getBotStatus, setBotStatusSink } from './cerberus/bot.js';
import type { BotStatus } from '../core/mute-bridge.js';

export function registerMuteIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('mute:get-all', (): boolean => isMutedAll());
  ipcMain.handle('mute:configured', (): boolean => telegramConfigured());
  ipcMain.handle('mute:set-all', (_e, on: unknown): boolean => setMutedAll(on === true));

  // The Telegram button owns both signals, so they share its bridge. Registered
  // before startCerberus runs, which is what makes the bot's first transition a
  // push and not something the renderer has to guess.
  ipcMain.handle('bot:status', (): BotStatus => getBotStatus());
  setBotStatusSink((s) => getWindow()?.webContents.send('cerberus:bot-status', s));

  // Mirror every flip to the renderer so the toggle can't drift out of sync.
  onMuteAllChange((active) => getWindow()?.webContents.send('cerberus:mute-all', active));
}
