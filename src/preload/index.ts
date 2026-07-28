import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { SpawnOptions, TerminalBridge } from '../core/terminal-bridge.js';
import type { ConfigBridge, ConfigTarget, SaveResult } from '../core/config-bridge.js';
import type {
  SettingsBridge,
  Settings,
  HookTargetStatus,
  SaveResult as SettingsSaveResult
} from '../core/settings.js';
import type { MuteBridge } from '../core/mute-bridge.js';

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
  list: () => ipcRenderer.invoke('pty:list') as Promise<string[]>,
  attach: (paneId, cols, rows) =>
    ipcRenderer.invoke('pty:attach', paneId, cols, rows) as Promise<string | null>,
  reap: (keep) => ipcRenderer.invoke('pty:reap', keep) as Promise<number>,
  write: (paneId, data) => ipcRenderer.send('pty:write', paneId, data),
  resize: (paneId, cols, rows) => ipcRenderer.send('pty:resize', paneId, cols, rows),
  kill: (paneId) => ipcRenderer.send('pty:kill', paneId),
  onData: (paneId, cb) => subscribe(dataListeners, paneId, cb),
  onExit: (paneId, cb) => subscribe(exitListeners, paneId, cb),
  cwd: (paneId) => ipcRenderer.invoke('pty:cwd', paneId) as Promise<string>,
  // Electron 32+ removed File.path; webUtils resolves a dropped File to its
  // absolute path so drag-and-drop can insert it into the pty.
  pathForFile: (file) => webUtils.getPathForFile(file)
};

contextBridge.exposeInMainWorld('cerberus', bridge);

const configBridge: ConfigBridge = {
  resolve: (paneId) => ipcRenderer.invoke('config:resolve', paneId) as Promise<ConfigTarget>,
  save: (path, content) => ipcRenderer.invoke('config:save', path, content) as Promise<SaveResult>
};

contextBridge.exposeInMainWorld('cerberusConfig', configBridge);

const settingsBridge: SettingsBridge = {
  get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
  save: (s) => ipcRenderer.invoke('settings:save', s) as Promise<SettingsSaveResult>,
  hooksStatus: () => ipcRenderer.invoke('settings:hooks-status') as Promise<HookTargetStatus[]>,
  hooksConsent: () =>
    ipcRenderer.invoke('settings:hooks-consent') as Promise<HookTargetStatus[] | null>,
  setHookTargets: (ids) =>
    ipcRenderer.invoke('settings:hooks-consent-set', ids) as Promise<SettingsSaveResult>
};

contextBridge.exposeInMainWorld('cerberusSettings', settingsBridge);

let onMuteAll: ((active: boolean) => void) | null = null;
ipcRenderer.on('cerberus:mute-all', (_e, active: boolean) => onMuteAll?.(active));

const muteBridge: MuteBridge = {
  getAll: () => ipcRenderer.invoke('mute:get-all') as Promise<boolean>,
  setAll: (on) => ipcRenderer.invoke('mute:set-all', on) as Promise<boolean>,
  configured: () => ipcRenderer.invoke('mute:configured') as Promise<boolean>,
  onChange: (cb) => {
    onMuteAll = cb;
  }
};

contextBridge.exposeInMainWorld('cerberusMute', muteBridge);

// Native-menu -> renderer bridge (Cmd+, opens settings). A contextBridge
// callback avoids cross-world DOM-event issues.
interface OpenPanePayload {
  file: string;
  title: string;
  cwd: string;
  format?: 'raw' | 'claude-stream';
  fmtPath?: string;
}
type TabAction = 'new' | 'close' | 'next' | 'prev' | 'select';
type EditAction = 'copy' | 'paste' | 'find';
interface PaneAttentionPayload {
  pane: string;
  sessionId: string;
}
let onOpenSettings: (() => void) | null = null;
let onToggleTheme: (() => void) | null = null;
let onOpenPane: ((p: OpenPanePayload) => void) | null = null;
let onTab: ((action: TabAction, index?: number) => void) | null = null;
let onPaneAttention: ((p: PaneAttentionPayload) => void) | null = null;
let onEdit: ((action: EditAction, text?: string) => void) | null = null;
ipcRenderer.on('cerberus:open-settings', () => onOpenSettings?.());
ipcRenderer.on('cerberus:toggle-theme', () => onToggleTheme?.());
ipcRenderer.on('cerberus:open-pane', (_e, p: OpenPanePayload) => onOpenPane?.(p));
ipcRenderer.on('cerberus:tab', (_e, action: TabAction, index?: number) => onTab?.(action, index));
ipcRenderer.on('cerberus:pane-attention', (_e, p: PaneAttentionPayload) => onPaneAttention?.(p));
ipcRenderer.on('cerberus:edit', (_e, action: EditAction, text?: string) => onEdit?.(action, text));
contextBridge.exposeInMainWorld('cerberusUI', {
  onOpenSettings: (cb: () => void) => {
    onOpenSettings = cb;
  },
  onToggleTheme: (cb: () => void) => {
    onToggleTheme = cb;
  },
  onOpenPane: (cb: (p: OpenPanePayload) => void) => {
    onOpenPane = cb;
  },
  onTab: (cb: (action: TabAction, index?: number) => void) => {
    onTab = cb;
  },
  onPaneAttention: (cb: (p: PaneAttentionPayload) => void) => {
    onPaneAttention = cb;
  },
  onEdit: (cb: (action: EditAction, text?: string) => void) => {
    onEdit = cb;
  },
  editFallback: (action: EditAction) => ipcRenderer.send('cerberus:edit-fallback', action),
  closeWindow: () => ipcRenderer.send('cerberus:close-window')
});
