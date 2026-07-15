# Fix — formatter `claude-stream` illeggibile (mojibake + comando echeggiato)

> Follow-up di `docs/orchestrator-panes-readable.md`. La feature funziona (testo, `tool`, footer
> compaiono), ma la presentazione è rotta. Questo task la ripulisce **senza cambiare il contratto**
> (`format` opt-in; raw e pane manuali restano identici).

## Sintomi (osservati a runtime)
1. In cima a ogni pane compare il **comando intero** `sh -c 'command -v jq … | jq -Rr … || tail -f …'` (wall of text).
2. I marker `▶`, `──`, `·` appaiono come **mojibake** (`?<0096>?`, `<0094><0080>`).
3. Righe header ripetute tipo `· ed4f62cb (?)`.

## Causa
In `src/renderer/main.ts` (~righe 100-107) il programma jq `CLAUDE_STREAM_FMT` è **inline e contiene caratteri non-ASCII** (`▶ ── · `). Quel programma viaggia come stringa: `daemon` (JSON) → `webContents.send` → preload → `shellQuote` → scrittura sul pty. I byte **multibyte UTF-8 si corrompono** lungo la catena → (a) mojibake visibile, (b) il programma jq arriva corrotto e produce output errato (le righe `· … (?)` ripetute). Il comando lungo, inoltre, viene echeggiato dalla shell della pane.

## Fix (una mossa risolve tutto)
Spostare il programma jq in un **file resource ASCII-only** e farlo leggere a jq da disco con `-f`. Così:
- il programma **non transita più** come stringa → niente corruzione, niente mojibake;
- i marker sono **ASCII** → nessun byte multibyte;
- l'`initialCommand` diventa **corto** → niente wall of text echeggiato;
- con il programma integro, il ramo `system` stampa **una sola** riga → via lo spam.

### 1) Nuovo file `resources/bin/claude-stream.jq` (ASCII-only)
```jq
. as $l
| (try fromjson catch null) as $e
| if   $e == null           then $l
  elif $e.type=="assistant" then
    ( $e.message.content[]?
      | if   .type=="text"     then .text
        elif .type=="tool_use" then "> " + .name + " " + ((.input // {}) | tojson)
        else empty end )
  elif $e.type=="result"    then
    "-- " + ($e.subtype // "done")
      + " | " + (($e.num_turns // 0)|tostring) + " turns"
      + " | $" + (($e.total_cost_usd // 0)|tostring)
  elif $e.type=="system"    then
    "- " + (($e.session_id // "?")[0:8]) + " (" + ($e.model // "?") + ")"
  else empty end
```
Eseguito con: `jq -Rr --unbuffered -f <path> <file-jsonl-in-pipe>`.

### 2) `electron-builder.yml`
Aggiungi `resources/bin/claude-stream.jq` agli `extraResources` (come già fatto per `resources/hooks/`), così esiste anche nei build pacchettizzati.

### 3) `src/main/cerberus/index.ts` (`startCerberus`)
Risolvi il path del `.jq` con la **stessa logica** già usata per `notify.sh`:
```ts
const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
const fmtPath = join(base, 'bin', 'claude-stream.jq');
```
e passalo al daemon (parametro o setter, es. `startDaemon(getWindow, { fmtPath })`).

### 4) `src/main/cerberus/daemon.ts`
Quando `format === "claude-stream"`, includi `fmtPath` nel payload dell'emit:
```ts
emit?.("cerberus:open-pane", { file, title, cwd, format, fmtPath });
```
(`fmtPath` presente solo per `claude-stream`; per `raw` resta assente.)

### 5) `src/preload/index.ts`
`OpenPanePayload` guadagna `fmtPath?: string`.

### 6) `src/renderer/main.ts` (righe ~100-131)
- **Rimuovi** la costante `CLAUDE_STREAM_FMT` inline.
- Costruisci l'`initialCommand` **senza `sh -c`** (lo scriviamo già dentro la shell della pane), con `shellQuote` su file **e** su `fmtPath`:
```ts
const q = shellQuote(file);
const initialCommand =
  format === 'claude-stream' && fmtPath
    ? `command -v jq >/dev/null 2>&1 && tail -f ${q} | jq -Rr --unbuffered -f ${shellQuote(fmtPath)} || tail -f ${q}\r`
    : `tail -f ${q}\r`;                       // ← ramo raw INVARIATO
```
`Layout.ts` / `Terminal.ts` non si toccano (pane resta read-only, one-shot).

## Alternativa minima (se vuoi il diff più piccolo)
Lascia il programma inline in `main.ts` ma **rendilo ASCII-only** (`>` invece di `▶`, `--` invece di `──`, `-` invece di `·`). Risolve mojibake, corruzione del programma e spam header. **Resta** l'echo del comando lungo (cosmetico). Il file-resource è comunque la soluzione migliore perché elimina anche quello.

## Definition of done
1. Pane `claude-stream` mostra testo pulito, **senza mojibake** e **senza il comando lungo** in cima.
2. Riga `system` stampata **una sola volta** (no spam).
3. `raw` / assenza di `format` / pane manuali: **identici a prima**.
4. `jq` assente → fallback `tail -f` grezzo (invariato).
5. Riga non-JSON → passthrough grezzo.
6. typecheck/build verdi; `claude-stream.jq` presente nel pacchetto.

## Output atteso (dopo il fix)
```
- ed4f62cb (claude-haiku-4-5-20251001)
Fatto. Haiku salvato in .orchestrator-test/work/t1-haiku.txt
> Write {"file_path":".../t1-haiku.txt","content":"..."}
-- success | 2 turns | $0.02
```
(niente comando `sh -c …` in testa, niente `?<0096>?`, niente righe `(?)` ripetute.)
