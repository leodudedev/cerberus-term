# Step 2 spec — pane tree + split (v/h) + kill

Repo: `cerberus-term` · Model: **Opus 4.8**
Status: **draft review — no code until approved**

## Goal

A binary-tree pane model + a renderer that materializes it as nested flex
layout. Operations: **split-right**, **split-down**, **kill** (with tree
collapse). Multiple live xterm/pty panes coexist; killing one collapses its
parent split and the sibling takes the parent's place.

## Why

The tree + collapse/relayout math is the spine of the whole multiplexer. Every
later step (splitters, headers, remote routing) addresses panes through this
model. Getting the reconciliation right — panes survive relayout without losing
scrollback or respawning their pty — is the hard, load-bearing part.

## Terminology (locked, to kill tmux ambiguity)

- **split-right** → new pane to the right → `dir: 'row'` (vertical divider).
- **split-down** → new pane below → `dir: 'column'` (horizontal divider).

Step 4 buttons map: **split-v = split-right (row)**, **split-h = split-down (column)**.

## The model — `src/renderer/pane-tree.ts`

```ts
export type Dir = 'row' | 'column';

export interface LeafNode {
  type: 'leaf';
  id: string;          // stable node id (uuid), NOT the pty paneId
}
export interface SplitNode {
  type: 'split';
  id: string;
  dir: Dir;
  ratio: number;       // fraction for child a, in (0,1); Step 3 mutates it
  a: PaneNode;
  b: PaneNode;
}
export type PaneNode = LeafNode | SplitNode;
```

Pure functions (no DOM, unit-testable):

- `newLeaf(): LeafNode`
- `splitLeaf(root, leafId, dir): PaneNode` — replace the target leaf with a
  `SplitNode{ dir, ratio: 0.5, a: oldLeaf, b: newLeaf }`. Returns new root +
  (separately) the new leaf's id so the caller can focus it.
- `killLeaf(root, leafId): PaneNode | null` — remove the leaf; its parent split
  collapses so the **sibling replaces the parent**. Killing the last leaf
  returns `null` (empty workspace).
- `firstLeaf(node): LeafNode`, `leaves(node): LeafNode[]` — traversal helpers
  (focus retargeting after kill, teardown).

Immutability: operations return a new tree (structural sharing where trivial);
avoids in-place aliasing bugs and makes Step 10 persistence a plain serialize.

## Rendering — `src/renderer/Layout.ts`

The renderer must preserve live terminals across relayout. Rule: **split wrapper
divs are rebuilt every render; leaf DOM elements are persistent and moved, never
recreated.**

- Keep `leaves: Map<leafId, { el: HTMLElement; pane: TerminalPane }>`.
- `render(root)` builds a fresh nested structure: a `SplitNode` → a flex `div`
  (`flex-direction: dir`) whose two children get `flex: 0 0 <pct>%` from `ratio`
  (min-size clamp so a pane can't vanish); a `LeafNode` → the **existing** `el`
  from the map (created + its `TerminalPane` spawned on first sight).
- Because leaf `el`s are `appendChild`-moved into the new wrappers (moving a DOM
  node doesn't destroy it), xterm state + pty survive. Build the new root
  offscreen, then `container.replaceChildren(newRoot)`.
- On kill: `pane.dispose()` (kill pty + dispose xterm) and drop the map entry
  **before** re-rendering the collapsed tree.
- A `ResizeObserver` per leaf `el` drives `fit()` + `bridge.resize` — this
  covers window resize, relayout, and (Step 3) splitter drags with one path.

## TerminalPane refactor — `src/renderer/Terminal.ts`

Step 1's `mountTerminal` becomes a controller so the tree can manage lifecycle:

```ts
export interface TerminalPane {
  readonly paneId: Promise<string>;
  focus(): void;
  onFocus(cb: () => void): void;   // click/focus -> tree marks this leaf focused
  dispose(): void;                 // kill pty, dispose xterm, disconnect observer
}
export function createTerminalPane(el: HTMLElement): TerminalPane;
```

Replaces the `window.addEventListener('resize', …)` with a per-`el`
`ResizeObserver`. xterm `onData`/pty wiring unchanged from Step 1.

## Driving it (temporary, Step 8 does the real keymap)

Focus tracking: clicking a pane focuses its xterm → `onFocus` sets
`focusedLeafId`; focused leaf gets a highlight border.

Temporary keys via xterm `attachCustomKeyEventHandler` (swallow so they don't
reach the shell), **Cmd-based to avoid shell collisions and Electron's default
Cmd+W/Cmd+Q**:

- **Cmd+D** → split-right (row)
- **Cmd+Shift+D** → split-down (column)
- **Cmd+K** → kill focused pane

Operate on `focusedLeafId`; after kill, refocus `firstLeaf` of the new tree.

## Files touched

```
src/renderer/pane-tree.ts   # NEW — model + pure ops
src/renderer/Layout.ts      # NEW — tree -> nested flex, leaf reconciliation
src/renderer/Terminal.ts    # EDIT — mountTerminal -> createTerminalPane controller
src/renderer/main.ts        # EDIT — boot a root leaf, wire Layout + temp keys
src/renderer/index.html      # EDIT — focused-pane border style (small)
```

No main/preload/core changes — the bridge from Step 1 already supports N panes
(paneId-namespaced). No new deps.

## Deliverable / verification

- Boot → one pane. Cmd+D / Cmd+Shift+D split; nested splits work.
- Each pane is a real independent shell (run `ls` in one, `top` in another).
- Cmd+K kills the focused pane; parent collapses, sibling fills the space; no
  orphaned pty (verify no leftover shell in `ps`), no leftover DOM.
- Relayout preserves scrollback (type output, split, output still there).
- `pnpm typecheck` + `pnpm build` green; `pnpm dev` exercised by hand.

## Explicitly out of scope

Draggable splitters / ratio mutation by mouse (Step 3), per-pane header + buttons
(Step 4), config editor (Step 5), Cerberus core / Telegram (Step 6), the real
keymap (Step 8). Ratios stay at 0.5 until Step 3.
```
