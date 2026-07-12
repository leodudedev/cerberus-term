# Step 5 spec — config editor button (`.cerberus.json`)

Repo: `cerberus-term` · Model: **Sonnet 5** (driven by Opus here)
Status: **draft review — no code until approved**

## Goal

The gear opens/creates the nearest `.cerberus.json` for the pane's cwd in an
in-app editor; Save writes it. Reuses the walk-up logic copied from
`mycli/src/project-config.ts`.

## First core copy-over

`mycli/src/project-config.ts` → `src/core/project-config.ts`, adapted:

- Inline a local `type Risk = 'safe' | 'caution' | 'danger'` instead of importing
  `classify.ts` (that module lands in Step 6; reconcile then).
- Keep `readProjectConfig` + `findConfigFile` (walk-up cwd→$HOME, mtime cache).
- Add `resolveConfigTarget(cwd): { path; exists }` — nearest existing file, else
  `<cwd>/.cerberus.json` (the create target).

## The pane's cwd (live, best-effort)

The gear must target where the shell **currently is**, not just where it
launched. `bridge-electron` already owns each pty; track its spawn cwd and add
`getPaneCwd(paneId)`:

- linux: `readlink /proc/<pid>/cwd`
- darwin: `lsof -a -p <pid> -d cwd -Fn` (parse the `n` line)
- fallback (Windows / any failure): the stored spawn cwd

Not a hot path (runs on gear click), so a one-shot `lsof` is fine.

## New IPC surface — `window.cerberusConfig`

Separate from `TerminalBridge` (terminal-only). New `src/core/config-bridge.ts`:

```ts
export interface ConfigTarget { path: string; exists: boolean; content: string; }
export interface ConfigBridge {
  resolve(paneId: string): Promise<ConfigTarget>;
  save(path: string, content: string):
    Promise<{ ok: true } | { ok: false; error: string }>;
}
```

- `resolve` (main): paneId → `getPaneCwd` → `resolveConfigTarget` → returns the
  path, whether it exists, and `content` (the file text, or a starter template
  when it doesn't exist yet).
- `save` (main): `JSON.parse`-validate; **guard the path** (absolute +
  `basename === '.cerberus.json'`) before writing utf8. Structured error back on
  bad JSON.

`src/main/config-ipc.ts` registers both handlers; preload exposes the typed
`window.cerberusConfig`.

## Editor UI — `src/renderer/ConfigEditor.ts`

A lightweight modal overlay: a `<textarea>` (monospace) with the JSON, a shown
target path, **Save** / **Cancel**, Esc to close. Save calls
`cerberusConfig.save`; on `{ok:false}` it surfaces the error inline and keeps the
modal open. One modal at a time.

Starter template for a new file:

```json
{
  "mute": false,
  "minRisk": "caution",
  "notifyIdle": true
}
```

## Wiring

- `Layout` gains `paneIdOf(leafId): Promise<string> | null` (map leaf → pane →
  its pty paneId).
- `main`'s `pane-cmd` handler: on `config`, resolve the target leaf's paneId and
  `openConfigEditor(paneId)`.

## Files touched

```
src/core/project-config.ts   # NEW — copied from mycli, adapted + resolveConfigTarget
src/core/config-bridge.ts    # NEW — ConfigBridge/ConfigTarget types
src/main/bridge-electron.ts  # EDIT — track cwd per pane, getPaneCwd
src/main/config-ipc.ts       # NEW — resolve/save IPC handlers
src/main/index.ts            # EDIT — register config IPC
src/preload/index.ts         # EDIT — expose window.cerberusConfig
src/renderer/cerberus.d.ts   # EDIT — window.cerberusConfig type
src/renderer/ConfigEditor.ts # NEW — modal editor
src/renderer/Layout.ts       # EDIT — paneIdOf
src/renderer/main.ts         # EDIT — handle 'config'
src/renderer/index.html      # EDIT — modal styles
```

No new deps.

## Deliverable / verification

- Gear on a pane whose cwd has no `.cerberus.json` → editor opens with the
  template + the create path; Save writes the file there.
- Gear on a pane inside a project that already has one (at or above cwd) → opens
  the existing file's content; Save updates it.
- `cd` into a subdir, then gear → targets the resolved path from the live cwd.
- Bad JSON → Save shows an error, doesn't write, modal stays open.
- `readProjectConfig`/`resolveConfigTarget` walk-up covered by assertions;
  typecheck + build green; editor exercised by hand.

## Explicitly out of scope

Cerberus core / Telegram consumption of the config (Step 6), global settings UI
(Step 7), schema-form editor (raw JSON textarea is enough here), live cwd on
Windows (best-effort fallback; real ConPTY cwd in Step 9).
```
