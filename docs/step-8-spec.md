# Step 8 spec — keyboard shortcuts (secondary method)

Repo: `cerberus-term` · Model: **Haiku 4.5** (driven by Opus here)
Status: **draft review — no code until approved**

## Goal

tmux-style keybindings mirroring the header buttons: split, kill, focus
navigation, resize. A leader key (Ctrl+B) then a command key, so the shell only
loses the leader — everything else stays.

## Bindings (leader = Ctrl+B)

```
%  or |   split-right (row)
"  or -   split-down  (column)
x        kill focused pane
h/j/k/l  focus left/down/up/right   (arrows too)
H/J/K/L  resize: move the nearest divider left/down/up/right (arrows+shift)
Esc      cancel the leader
```

Leader + command are swallowed (never reach the shell). The leader times out
after 2s. The existing direct Cmd combos (Cmd+D/Cmd+Shift+D/Cmd+K) stay as a
convenience.

## Mechanism — `src/renderer/keymap.ts`

A window-level **capture** keydown listener (fires before xterm, so it can
`preventDefault` + `stopImmediatePropagation` to keep keys off the pty):

- not pending + leader → enter pending, start 2s timer, swallow.
- pending → match the command, dispatch a `cerberus-action` CustomEvent, clear
  pending, swallow. Unmatched/Esc → just clear pending.

`cerberus-action` detail: `{ type: 'split'|'kill'|'focus'|'resize', dir?: 'left'|'right'|'up'|'down' }`.

## Model + geometry helpers

- `pane-tree.ts` — `resizeNearest(root, leafId, axis, delta)`: finds the deepest
  ancestor split whose `dir === axis` on the path to the leaf and nudges its
  ratio by `delta` (clamped). Divider-move semantics: right/down = +, left/up =
  −. No-op if there's no matching ancestor.
- `Layout.ts` — `leafInDirection(fromId, dir)`: geometric nearest-neighbour from
  the focused pane's rect (half-plane in `dir`, min centre distance). Returns a
  leafId or null.

## Wiring — `src/renderer/main.ts`

Install the keymap; handle `cerberus-action`:

- `split` → `split(dir==='down'?'column':'row', focusedLeafId)`
- `kill` → `kill(focusedLeafId)`
- `focus` → `leafInDirection` → focus it
- `resize` → `resizeNearest` (axis from dir, ±0.04) → `render` + refocus

## Files touched

```
src/renderer/keymap.ts     # NEW — leader state machine, key -> cerberus-action
src/renderer/pane-tree.ts  # EDIT — resizeNearest + helpers
src/renderer/Layout.ts     # EDIT — leafInDirection
src/renderer/main.ts       # EDIT — installKeymap + cerberus-action handler
```

No main/preload/core changes; no new deps.

## Deliverable / verification

- Ctrl+B then %/" splits; x kills; h/j/k/l (and arrows) move focus; H/J/K/L
  resize; the leader alone never leaks to the shell.
- `resizeNearest` + a `leafInDirection` shape covered by assertions; typecheck +
  build green; keys exercised by hand.

## Explicitly out of scope

Configurable leader / rebinding UI (later), pane zoom/maximize, copy-mode,
session restore (Step 10).
```
