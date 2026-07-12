import { app } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { setStatePath } from '../../core/persist.js';
import { loadEnvFile } from './env.js';
import { installClaudeHooks } from './hook-install.js';
import { startDaemon } from './daemon.js';

// Boot the Cerberus remote-control core from the Electron main process:
// load Telegram creds, point persistence at userData, install CLI hooks,
// start the loopback daemon + Telegram bot.
export function startCerberus(): void {
  loadEnvFile();
  setStatePath(join(app.getPath('userData'), 'cerberus-state.json'));

  // In dev app.getAppPath() is the repo root; in a packaged app the hook is
  // shipped via extraResources (Step 9).
  const notifyScript = join(app.getAppPath(), 'resources', 'hooks', 'notify.sh');
  if (existsSync(notifyScript)) {
    installClaudeHooks(notifyScript);
  } else {
    console.error('[cerberus] notify.sh not found at', notifyScript);
  }

  startDaemon();
}
