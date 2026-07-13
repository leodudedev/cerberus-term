// tmux-style keyboard control: a leader (Ctrl+B) then a command key. Runs as a
// window-level CAPTURE listener so it fires before xterm and can swallow the
// keys (preventDefault + stopImmediatePropagation) — the shell only loses the
// leader, nothing else.

export type Dir = 'left' | 'right' | 'up' | 'down';
export interface CerberusAction {
  type: 'split' | 'kill' | 'focus' | 'resize';
  dir?: Dir;
}

const LEADER_TIMEOUT_MS = 2000;

function isLeader(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'b';
}

// Map a command key (while pending) to an action. Returns null to cancel.
function resolve(e: KeyboardEvent): CerberusAction | null | undefined {
  const k = e.key;
  const lower = k.toLowerCase();
  const shift = e.shiftKey;

  if (k === '%' || k === '|') return { type: 'split', dir: 'right' };
  if (k === '"' || k === '-') return { type: 'split', dir: 'down' };
  if (lower === 'x') return { type: 'kill' };
  if (k === 'Escape') return null; // cancel

  const focusMap: Record<string, Dir> = { h: 'left', j: 'down', k: 'up', l: 'right' };
  const arrowMap: Record<string, Dir> = {
    ArrowLeft: 'left',
    ArrowDown: 'down',
    ArrowUp: 'up',
    ArrowRight: 'right'
  };

  const dir = focusMap[lower] ?? arrowMap[k];
  if (dir) return { type: shift ? 'resize' : 'focus', dir };

  return undefined; // unmatched -> cancel silently, same as null
}

export function installKeymap(): void {
  let pending = false;
  let timer: number | undefined;

  const clearPending = (): void => {
    pending = false;
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };

  window.addEventListener(
    'keydown',
    (e) => {
      if (!pending) {
        if (!isLeader(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        pending = true;
        timer = window.setTimeout(clearPending, LEADER_TIMEOUT_MS);
        return;
      }

      // pending: wait for the real key, don't let a lone modifier cancel it
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;

      // this key is the command (or a cancel)
      e.preventDefault();
      e.stopImmediatePropagation();
      const action = resolve(e);
      clearPending();
      if (action) {
        window.dispatchEvent(new CustomEvent<CerberusAction>('cerberus-action', { detail: action }));
      }
    },
    true
  );
}
