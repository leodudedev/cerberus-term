# Step 3 spec — draggable splitters (resize)

Repo: `cerberus-term` · Model: **Sonnet 5** (driven by Opus here)
Status: **draft review — no code until approved**

## Goal

Drag the border between two panes to change their split ratio. Clamp to a
minimum pane size; persist the ratio in the tree so it survives further
splits/kills.

## Why

Ratios are already in the model (`SplitNode.ratio`, fixed at 0.5 since Step 2).
This wires mouse control to that field — the last piece before panes feel like a
real multiplexer. Headers/buttons (Step 4) build on the same layout.

## Layout change: flex-grow instead of flex-basis

Step 2 sized children with `flex: 0 0 <pct>%`. A fixed-px splitter between them
would overflow that 100%. Switch to **proportional flex-grow**:

- each child: `flex: <grow> 1 0` where `grow` = `ratio` (child a) / `1 - ratio`
  (child b) — children share the space left after the splitter.
- splitter: `flex: 0 0 6px`, fixed thickness, no overflow math.

## Splitter — `src/renderer/Splitter.ts`

A thin bar appended **between** a split's two children. Self-contained: on
pointer-drag it reads its parent (the split `div`) rect and computes the new
ratio; no external size plumbing.

```ts
export function makeSplitter(
  dir: Dir,
  onResize: (ratio: number) => void,  // live, every move: update child flex-grow
  onCommit: (ratio: number) => void   // pointerup: persist ratio into the model
): HTMLElement;
```

- Orientation: `dir: 'row'` → vertical bar, `col-resize`; `dir: 'column'` →
  horizontal bar, `row-resize`. Hover highlight.
- Drag math: parent rect from `el.parentElement.getBoundingClientRect()`;
  `ratio = (pointerAlongAxis - rectStart) / rectSize`.
- **Clamp**: min 60px per side → `ratio ∈ [60/size, 1 - 60/size]`.
- `setPointerCapture` for smooth tracking; `body { user-select: none }` during
  drag; `stopPropagation` so the drag never reaches the terminals.

## Live vs commit (no render churn)

- **During drag** (`onResize`): set `flexGrow` directly on the two child
  elements. No tree render — the `ResizeObserver` on each leaf already refits
  xterm + resizes the pty live.
- **On pointerup** (`onCommit`): write the ratio into the model via `setRatio`.
  No re-render needed — the DOM already reflects it; the model just stays in
  sync for the next split/kill and for Step 10 persistence.

## Model op — `src/renderer/pane-tree.ts`

```ts
export function setRatio(root: PaneNode, splitId: string, ratio: number): PaneNode;
```

Pure/immutable; clamps ratio to a safe `[0.05, 0.95]` as a guard.

## Layout wiring — `src/renderer/Layout.ts`

`build()` for a `SplitNode`: append `[childA, splitter, childB]`; `sizeChild`
now sets `flexGrow`. Splitter callbacks capture the two child els + `node.id`;
`onResize` mutates their `flexGrow`, `onCommit` calls a new constructor callback
`onRatioChange(splitId, ratio)` → main updates `root` (no render).

## Files touched

```
src/renderer/Splitter.ts    # NEW — drag bar + ratio math
src/renderer/pane-tree.ts   # EDIT — setRatio
src/renderer/Layout.ts      # EDIT — flex-grow sizing, insert splitters, wire
src/renderer/main.ts        # EDIT — onRatioChange -> setRatio(root,…)
```

No main/preload/core changes; no new deps.

## Deliverable / verification

- Drag a divider → panes resize smoothly, terminals reflow live.
- Clamp holds: a pane can't be dragged below ~60px.
- Ratio persists: resize, then split the neighbour — the dragged ratio stays.
- `setRatio` + ratio-survives-split covered by assertions; typecheck + build
  green; drag exercised by hand (pointer events aren't headless-driven).

## Explicitly out of scope

Per-pane header/buttons (Step 4), config editor (Step 5), Cerberus core (Step 6),
real keymap (Step 8). Double-click-to-reset / keyboard resize deferred to Step 8.
```
