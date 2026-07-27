import { ipcMain, type BrowserWindow } from 'electron';
import { isMutedAll, setMutedAll, onMuteAllChange } from '../core/mute.js';

export function registerMuteIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('mute:get-all', (): boolean => isMutedAll());
  ipcMain.handle('mute:set-all', (_e, on: unknown): boolean => setMutedAll(on === true));

  // Mirror every flip to the renderer so the toggle can't drift out of sync.
  onMuteAllChange((active) => getWindow()?.webContents.send('cerberus:mute-all', active));
}
