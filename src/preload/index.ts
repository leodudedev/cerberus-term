import { contextBridge, ipcRenderer } from 'electron';
import type { SpawnOptions, TerminalBridge } from '../core/terminal-bridge.js';
import type { ConfigBridge, ConfigTarget, SaveResult } from '../core/config-bridge.js';
import type {
  SettingsBridge,
  Settings,
  SaveResult as SettingsSaveResult
} from '../core/settings.js';

// Per-pane fan-out for the shared pty:data / pty:exit channels. The main
// process tags every message with its paneId; we dispatch to subscribers here
// so the renderer gets a clean per-pane callback API.
type DataCb = (data: string) => void;
type ExitCb = (code: number) => void;

const dataListeners = new Map<string, Set<DataCb>>();
const exitListeners = new Map<string, Set<ExitCb>>();

ipcRenderer.on('pty:data', (_e, paneId: string, data: string) => {
  dataListeners.get(paneId)?.forEach((cb) => cb(data));
});

ipcRenderer.on('pty:exit', (_e, paneId: string, code: number) => {
  exitListeners.get(paneId)?.forEach((cb) => cb(code));
  dataListeners.delete(paneId);
  exitListeners.delete(paneId);
});

function subscribe<T>(map: Map<string, Set<T>>, paneId: string, cb: T): () => void {
  let set = map.get(paneId);
  if (!set) {
    set = new Set<T>();
    map.set(paneId, set);
  }
  set.add(cb);
  return () => {
    map.get(paneId)?.delete(cb);
  };
}

const bridge: TerminalBridge = {
  spawn: (opts: SpawnOptions) => ipcRenderer.invoke('pty:spawn', opts) as Promise<string>,
  write: (paneId, data) => ipcRenderer.send('pty:write', paneId, data),
  resize: (paneId, cols, rows) => ipcRenderer.send('pty:resize', paneId, cols, rows),
  kill: (paneId) => ipcRenderer.send('pty:kill', paneId),
  onData: (paneId, cb) => subscribe(dataListeners, paneId, cb),
  onExit: (paneId, cb) => subscribe(exitListeners, paneId, cb)
};

contextBridge.exposeInMainWorld('cerberus', bridge);

const configBridge: ConfigBridge = {
  resolve: (paneId) => ipcRenderer.invoke('config:resolve', paneId) as Promise<ConfigTarget>,
  save: (path, content) => ipcRenderer.invoke('config:save', path, content) as Promise<SaveResult>
};

contextBridge.exposeInMainWorld('cerberusConfig', configBridge);

const settingsBridge: SettingsBridge = {
  get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
  save: (s) => ipcRenderer.invoke('settings:save', s) as Promise<SettingsSaveResult>
};

contextBridge.exposeInMainWorld('cerberusSettings', settingsBridge);

// Native-menu -> renderer bridge (Cmd+, opens settings). A contextBridge
// callback avoids cross-world DOM-event issues.
let onOpenSettings: (() => void) | null = null;
ipcRenderer.on('cerberus:open-settings', () => onOpenSettings?.());
contextBridge.exposeInMainWorld('cerberusUI', {
  onOpenSettings: (cb: () => void) => {
    onOpenSettings = cb;
  }
});
