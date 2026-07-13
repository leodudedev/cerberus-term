# Step 9 spec — packaging & cross-platform

Repo: `cerberus-term` · Model: **Sonnet 5** (Opus if signing gets thorny)
Status: **draft review — no code until approved**

## Goal

Installable artifacts on macOS (dmg), Windows (nsis), Linux (AppImage/deb) via
electron-builder. Native module (node-pty) packaged correctly; the Cerberus hook
scripts ship and resolve in a packaged app. App icon + auto-update deferred.

## electron-builder config — `electron-builder.yml`

- `files`: `out/**` (electron-vite output) + `package.json`.
- `asarUnpack`: `**/node_modules/node-pty/**` — a native `.node` can't load from
  inside the asar.
- `extraResources`: `resources/hooks` → `hooks` (ships notify.sh /
  copilot-notify.sh next to the app; shell can't exec inside asar, and
  `process.resourcesPath` is where they land).
- `npmRebuild: false` — node-pty is already built against the Electron ABI by our
  `@electron/rebuild` postinstall on the build host.
- Targets: mac `dmg` (category developer-tools), win `nsis`, linux `AppImage` +
  `deb`.

## Packaged hook path — `src/main/cerberus/index.ts`

Dev uses `app.getAppPath()/resources/hooks`; packaged must use
`process.resourcesPath/hooks` (extraResources land outside the asar):

```ts
const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
const notifyScript = join(base, 'hooks', 'notify.sh');
```

## Scripts — `package.json`

```
"pack": "electron-vite build && electron-builder --dir"   # unpacked, for verify
"dist": "electron-vite build && electron-builder"          # current OS installer
"dist:mac":  "... --mac",
"dist:win":  "... --win",
"dist:linux":"... --linux"
```

## CI — `.github/workflows/build.yml`

Matrix macos/windows/ubuntu, Node 22, pnpm, `pnpm install` (runs the rebuild
postinstall), `pnpm dist`. Uploads artifacts. ConPTY verification on Windows is
the run itself (node-pty uses ConPTY natively on Win).

## Verification (local, macOS)

- `pnpm pack` (electron-builder `--dir`, signing off via
  `CSC_IDENTITY_AUTO_DISCOVERY=false`) → produces `dist/mac*/Cerberus.app` with
  node-pty unpacked under `app.asar.unpacked` and `hooks/` in Resources.
- Launch the packaged `.app` headless-ish: confirm it boots, spawns a pty,
  daemon binds :8898, hook path resolves to `process.resourcesPath/hooks`.
- Full dmg/nsis/AppImage builds happen in CI (can't cross-build here).

## Explicitly out of scope

Code signing / notarization (needs certs; hook up later), auto-update, a custom
app icon (ships with the default Electron icon for now — asset TODO), Windows/
Linux local builds (CI matrix covers them).
```
