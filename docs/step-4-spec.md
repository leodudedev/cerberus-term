# Step 4 spec — per-pane header + buttons

Repo: `cerberus-term` · Model: **Sonnet 5** (driven by Opus here)
Status: **draft review — no code until approved**

## Goal

A thin header on every pane: title on the left, buttons on the right —
**split-v, split-h, kill**, plus a slightly separated **config gear**. Buttons
drive the existing Step 2/3 operations on **that** pane (not just the focused
one). The header is also the future drag handle.

## Leaf DOM restructure

Today a leaf `el` hosts xterm directly. Now each leaf becomes a column:

```
.pane (flex column)
├── .pane-header   (flex 0 0 26px)  title | buttons
└── .pane-body     (flex 1 1 0)     xterm mounts here
```

`createTerminalPane` receives the **body**, not the whole leaf. Its
`ResizeObserver` moves to the body, so header height is excluded from fit math.
No change to the terminal wiring itself.

## Buttons → operations (target = this pane's leafId)

Header buttons dispatch the same `pane-cmd` window event as the temp keymap, but
with a `leafId` in the detail so they act on their own pane regardless of focus:

- **split-v** → `split-right` (`dir: 'row'`)
- **split-h** → `split-down` (`dir: 'column'`)
- **kill** → `kill`
- **config gear** (separated) → `config` — **inert placeholder**, wired in Step 5.

`main` resolves `target = detail.leafId ?? focusedLeafId` (keyboard path keeps
using the focused pane). `split`/`kill` become `(…, leafId)`-parameterized.

Icons: unicode glyphs with `title` tooltips (split-v `◧`, split-h `⬓`, kill `✕`,
gear `⚙`). Buttons `stopPropagation` so a click doesn't start a drag; clicking
the header background (not a button) focuses the pane.

## Focus-preserving kill

Button-killing a **non-focused** pane keeps the current focus if that leaf still
exists (else falls back to `firstLeaf`). Keyboard kill (focused pane) behaves as
before.

## Files touched

```
src/renderer/PaneHeader.ts   # NEW — header + buttons, dispatches pane-cmd
src/renderer/Layout.ts       # EDIT — leaf = header + body; mount xterm in body
src/renderer/main.ts         # EDIT — split/kill take leafId; resolve target
src/renderer/index.html      # EDIT — header/button styles
```

No main/preload/core/pane-tree changes; no new deps.

## Deliverable / verification

- Every pane shows a header; clicking split-v/split-h/kill on any pane performs
  that op on that pane.
- Killing a background pane keeps focus where it was.
- Gear is present, tooltipped, inert (Step 5).
- typecheck + build green; buttons exercised by hand.

## Explicitly out of scope

Config editor behind the gear (Step 5), header drag-to-rearrange (later),
real titles/cwd (Step 6/10), real keymap (Step 8).
```
