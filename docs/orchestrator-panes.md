# Addon — pane auto-aperte per l'orchestratore (`POST /pane`)

> Obiettivo: permettere a un processo **esterno** (es. un orchestratore
> multi-sessione) di far aprire a Cerberus una **pane read-only** che segue il log di un worker `claude -p`.
> Oggi le pane le crea solo il renderer (utente); manca un ingresso esterno. Questa è la spec di
> implementazione — modifiche piccole, tutte su seam già esistenti.

## Come funziona oggi (verificato sul codice)

- **Daemon HTTP loopback** in `src/main/cerberus/daemon.ts`: `createServer`, route per `req.method`+`req.url` (`GET /health`, `POST /event`), avviato da `startDaemon()` su `127.0.0.1:config.port`. **Non ha** riferimenti a `mainWindow`.
- **main → renderer** già usato per `cerberus:open-settings` / `cerberus:toggle-theme`: `src/main/index.ts` fa `mainWindow.webContents.send(...)`; il preload `src/preload/index.ts` lo ri-espone via `onOpenSettings`; il renderer `src/renderer/main.ts` lo consuma (`window.cerberusUI.onOpenSettings(...)`).
- **Le pane nascono nel renderer**: `split(dir, leafId)` in `main.ts` (usa `splitLeaf` da `Layout.ts`, che ritorna `newLeafId`) + spawn pty via `window.cerberusUI.spawn(opts)` (preload) → `ipcMain.handle('pty:spawn')` in `bridge-electron.ts`. `SpawnOptions = { cwd, cols, rows, shell?, env? }`: la shell è spawnata **senza args**, quindi per un follower si scrive il comando con `pty:write` dopo lo spawn.

## Design

Nuovo endpoint `POST /pane` sul daemon → segnale `cerberus:open-pane` al renderer → il renderer crea uno split e apre una pane che esegue `tail -f <file>` (MVP), marcata read-only.

```
orchestrator/driver ─POST /pane {file,title}→ daemon ─send('cerberus:open-pane')→ preload → renderer
                                                                                        │
                                                        split() + spawn shell + write "tail -f <file>"
```

## Modifiche file-per-file

### 1) `src/main/cerberus/daemon.ts`
Aggiungi un emitter verso il renderer e un route `POST /pane`.

```ts
import { type BrowserWindow } from "electron";

let emit: ((ch: string, payload: unknown) => void) | null = null;

// dentro il createServer(async (req,res) => { ... }), accanto a "/event":
if (req.method === "POST" && req.url === "/pane") {
  let body: { file?: string; title?: string; cwd?: string };
  try { body = (await readJson(req)) as typeof body; }
  catch { res.writeHead(400, {"content-type":"application/json"}); res.end(JSON.stringify({error:"bad_json"})); return; }
  if (!body?.file) { res.writeHead(400, {"content-type":"application/json"}); res.end(JSON.stringify({error:"missing_file"})); return; }
  emit?.("cerberus:open-pane", { file: body.file, title: body.title ?? "", cwd: body.cwd ?? "" });
  res.writeHead(200, {"content-type":"application/json"});
  res.end(JSON.stringify({ ok: true }));
  return;
}

// firma aggiornata:
export function startDaemon(getWindow: () => BrowserWindow | null): void {
  emit = (ch, payload) => getWindow()?.webContents.send(ch, payload);
  server.listen(config.port, "127.0.0.1", () => {
    console.log(`[daemon] listening on http://127.0.0.1:${config.port}`);
    initBot();
  });
}
```

### 2) `src/main/cerberus/index.ts`
Propaga il window handle:
```ts
export function startCerberus(getWindow: () => BrowserWindow | null): void {
  // ...invariato...
  startDaemon(getWindow);
}
```

### 3) `src/main/index.ts`
Passa `mainWindow` (già presente): `startCerberus(() => mainWindow)` al posto di `startCerberus()`.

### 4) `src/preload/index.ts`
Mirror di `onOpenSettings` (righe ~69-75):
```ts
let onOpenPane: ((p: { file: string; title: string; cwd: string }) => void) | null = null;
ipcRenderer.on('cerberus:open-pane', (_e, p) => onOpenPane?.(p));
// dentro l'oggetto esposto come window.cerberusUI:
onOpenPane: (cb: (p: { file: string; title: string; cwd: string }) => void) => { onOpenPane = cb; },
```
(aggiorna anche il tipo `cerberusUI` se dichiarato in un `.d.ts`.)

### 5) `src/renderer/main.ts`
Registra il consumer accanto a `window.cerberusUI.onOpenSettings(...)` (riga ~93):
```ts
window.cerberusUI.onOpenPane(({ file, title, cwd }) => {
  // split() oggi non ritorna l'id: usa splitLeaf direttamente per avere newLeafId,
  // oppure fai ritornare newLeafId a split().
  const { root: next, newLeafId } = splitLeaf(root, focusedLeafId, 'row');
  root = next;
  // ...monta il leaf come per una pane normale, ottieni il suo paneId dallo spawn...
  // const paneId = await window.cerberusUI.spawn({ cwd: cwd || defaultCwd, cols, rows });
  // window.cerberusUI.write(paneId, `tail -f ${shellQuote(file)}\r`);
  // markReadOnly(newLeafId);  // vedi punto 6
  // usa title per l'header del leaf, se disponibile
});
```
Riusa la stessa sequenza spawn→attach già usata per le pane manuali; l'unica differenza è il `write` iniziale del `tail` e il flag read-only.

### 6) Read-only (nicety, opzionale per l'MVP)
Aggiungi un flag `readOnly` al modello del leaf e, nell'input handler di `src/renderer/Terminal.ts`, **ignora i keystroke** quando è attivo (lascia passare solo resize/scroll). MVP senza flag: una pane con `tail -f` è di fatto sola-lettura, l'utente semplicemente non digita.

## Lato orchestratore / driver (repo esterno, NON Cerberus)

Dopo aver lanciato il worker con log su file, chiamata **best-effort**:
```bash
curl -fsS -X POST "http://127.0.0.1:${CERBERUS_PORT}/pane" \
  -H 'content-type: application/json' \
  -d "{\"file\":\"$PWD/.orchestrator-test/out/$id.jsonl\",\"title\":\"$id\"}" || true
```
`CERBERUS_PORT` è **già iniettato da Cerberus** nelle sue pane (vedi `bridge-electron.ts`, `env.CERBERUS_PORT`). Fuori da Cerberus la variabile non c'è / il curl fallisce e si ignora (`|| true`) → l'orchestratore resta **Cerberus-agnostico**.

## Test manuale
1. `pnpm dev`, apri almeno una pane.
2. In un terminale: `echo hi > /tmp/x.log` poi `curl -X POST http://127.0.0.1:<porta>/pane -H 'content-type: application/json' -d '{"file":"/tmp/x.log","title":"demo"}'`.
3. Deve comparire una nuova pane che fa `tail -f /tmp/x.log`; `echo more >> /tmp/x.log` aggiorna live.

## Note / rischi
- **Sicurezza:** il daemon è solo loopback (`127.0.0.1`) → ok. `file` arriva da localhost; opzionale: valida che sia un path assoluto (evita comandi iniettati nel `tail`; usa un vero quoting/escape su `shellQuote`).
- `config.port` è la porta del daemon (`src/core/config.ts`).
- Lo stream dei worker è **JSONL** (`--output-format stream-json`): valuta un formatter leggibile al posto del `tail -f` grezzo, es. `tail -f file | jq -rc '.type + " " + (.subtype // "")'`.
- Nessun impatto sul flusso esistente: `/event` e le pane manuali restano invariati; l'addon è puramente additivo.
