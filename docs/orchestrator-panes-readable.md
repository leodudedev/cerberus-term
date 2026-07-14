# Addon — follower pane leggibili per stream-json (`format: "claude-stream"`)

> **Obiettivo:** quando l'orchestratore apre una pane che segue il log di un worker `claude -p`
> (`--output-format stream-json`, un JSONL grezzo), la pane deve mostrare una **proiezione
> leggibile** (testo dell'assistant, tool chiamati, esito) invece del JSON riga-per-riga.
>
> **Invariante non negoziabile:** il comportamento attuale resta **identico** per tutto il resto.
> Le pane manuali (utente) non cambiano di una virgola; una `POST /pane` **senza** il nuovo campo
> si comporta esattamente come oggi (`tail -f` grezzo). La leggibilità è **opt-in**, attivata solo
> quando l'orchestratore la chiede esplicitamente.

Companion di `docs/orchestrator-panes.md` (che ha introdotto `POST /pane`).

## Stato attuale (verificato sul codice)

- `POST /pane {file,title,cwd}` → `daemon.ts` emette `cerberus:open-pane` (≈ riga 144) → preload (`OpenPanePayload`, ≈ riga 79) → `renderer/main.ts`.
- `renderer/main.ts:104-108`: apre un leaf con
  ```ts
  layout.setPaneSpec(newLeafId, {
    cwd, title,
    initialCommand: `tail -f ${shellQuote(file)}\r`,
    readOnly: true
  });
  ```
- `Layout.ts`: `PaneSpec { cwd?; title?; initialCommand?; readOnly? }`; alla creazione scrive `initialCommand` (one-shot) e applica `readOnly`.

Cioè il follower **è** un `tail -f` in una pane read-only. Rendere leggibile = **cambiare solo l'`initialCommand`** quando richiesto, lasciando tutto il resto uguale.

## Design

Aggiungere un campo opzionale `format` a `POST /pane`:

| `format` | initialCommand del follower | Uso |
|----------|-----------------------------|-----|
| assente / `"raw"` | `tail -f <file>` (**come oggi**) | pane manuali, qualunque follower generico |
| `"claude-stream"` | `tail -f <file>` **filtrato con un formatter** | log JSONL dei worker `claude -p` |

Nessuna euristica implicita sull'estensione: si formatta **solo** se `format:"claude-stream"` è passato. Così niente cambia per errore.

## Formatter (proiezione leggibile)

Filtra lo stream-json di Claude Code negli eventi che contano, **passando attraverso** le righe non-JSON (robustezza: se il file non fosse stream-json, o `tail` consegnasse una riga sporca, la si stampa grezza invece di rompere la pane).

Programma `jq` di riferimento (`FMT`):
```
jq -Rr --unbuffered '
  . as $l
  | (try fromjson catch null) as $e
  | if   $e == null            then $l
    elif $e.type=="assistant"  then
      ($e.message.content[]?
        | if   .type=="text"     then .text
          elif .type=="tool_use" then "▶ " + .name + " " + ((.input // {}) | tojson)
          else empty end)
    elif $e.type=="result"     then
      "── " + ($e.subtype // "done")
        + " · " + (($e.num_turns // 0)|tostring) + " turns"
        + " · $" + (($e.total_cost_usd // 0)|tostring)
    elif $e.type=="system"     then
      "· " + (($e.session_id // "?")[0:8]) + " (" + ($e.model // "?") + ")"
    else empty end'
```
Rende: testo dell'assistant, `▶ <tool> <input>` per ogni tool_use, `── <subtype> · N turns · $costo` a fine run, una riga di header per l'init. Tutto il resto (tool_result verbosi, ping, rate_limit) viene scartato.

## Dipendenza `jq` — fallback obbligatorio

`jq` potrebbe non essere installato sulla macchina. Il follower `claude-stream` deve **degradare a `tail -f` grezzo** se `jq` manca, mai fallire:

```
sh -c 'command -v jq >/dev/null 2>&1 && tail -f <file> | <FMT> || tail -f <file>'
```
(In alternativa, per i build pacchettizzati: spedire un piccolo formatter dependency-free in `resources/bin/` e usarlo al posto di `jq`, con lo stesso fallback a `tail` grezzo. Scelta libera dell'implementatore: l'importante è il fallback.)

## Modifiche file-per-file

### 1) `src/main/cerberus/daemon.ts` — route `POST /pane`
- Leggi il campo opzionale `format` dal body; valida contro l'enum `"raw" | "claude-stream"` (default `"raw"`; qualsiasi valore ignoto → `"raw"`).
- Includilo nel payload dell'emit:
  ```ts
  emit?.("cerberus:open-pane", { file: body.file, title: body.title ?? "", cwd: body.cwd ?? "", format });
  ```
- Nessun'altra logica del route cambia (path assoluto ancora obbligatorio, ecc.).

### 2) `src/preload/index.ts`
- Estendi `OpenPanePayload` con `format?: 'raw' | 'claude-stream'`. Nessun altro cambiamento.

### 3) `src/renderer/main.ts` (righe ~104-108)
- Costruisci l'`initialCommand` in base a `format`, tenendo il ramo raw **identico a oggi**:
  ```ts
  const q = shellQuote(file);
  const initialCommand =
    payload.format === 'claude-stream'
      ? `sh -c ${shellQuote(`command -v jq >/dev/null 2>&1 && tail -f ${q} | ${FMT} || tail -f ${q}`)}\r`
      : `tail -f ${q}\r`;                       // ← ramo attuale, invariato
  layout.setPaneSpec(newLeafId, { cwd, title, initialCommand, readOnly: true });
  ```
  `FMT` = il programma `jq` sopra (definiscilo come costante stringa; attenzione al quoting annidato — usa `shellQuote` per il comando passato a `sh -c`).

`Layout.ts` e `Terminal.ts` **non si toccano**: la pane resta read-only e one-shot come adesso.

## Lato orchestratore (repo Trigano, non qui)

La `POST /pane` guadagna un campo; l'orchestratore lo passa solo per i log dei worker:
```bash
curl -fsS -X POST "http://127.0.0.1:$CERBERUS_PORT/pane" \
  -H 'content-type: application/json' \
  -d "{\"file\":\"$PWD/.orchestrator-test/out/$id.jsonl\",\"title\":\"$id\",\"format\":\"claude-stream\"}" || true
```
Chi non passa `format` (qualsiasi altro uso, incluse chiamate esistenti) ottiene il `tail -f` grezzo di sempre.

## Definition of done (invarianti da verificare)

1. **Pane manuali:** identiche a prima (nessuna regressione su split/spawn/keys).
2. **`POST /pane` senza `format`** (o `"raw"`): follower = `tail -f` grezzo, come oggi.
3. **`POST /pane` con `format:"claude-stream"`:** la pane mostra testo leggibile su un `.jsonl` reale di un worker (`claude -p --output-format stream-json`).
4. **`jq` assente:** il follower `claude-stream` cade su `tail -f` grezzo, senza errori.
5. **Righe non-JSON / parziali:** stampate grezze, la pane non si rompe.
6. Sicurezza invariata: solo loopback, path assoluto, `shellQuote` su file **e** sul comando passato a `sh -c`.

## Test manuale
```bash
# in un terminale genera un finto stream:
f=/tmp/w.jsonl; : > "$f"
printf '%s\n' '{"type":"system","session_id":"abcd1234","model":"claude-sonnet-5"}' >> "$f"
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"Scrivo il file."}]}}' >> "$f"
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"path":"x.txt"}}]}}' >> "$f"
printf '%s\n' '{"type":"result","subtype":"success","num_turns":2,"total_cost_usd":0.01}' >> "$f"
printf '%s\n' 'riga NON json di prova' >> "$f"

# poi (dentro Cerberus):
curl -X POST http://127.0.0.1:<porta>/pane -H 'content-type: application/json' \
  -d '{"file":"/tmp/w.jsonl","title":"fmt","format":"claude-stream"}'
```
Atteso nella pane:
```
· abcd1234 (claude-sonnet-5)
Scrivo il file.
▶ Write {"path":"x.txt"}
── success · 2 turns · $0.01
riga NON json di prova
```
E una `POST /pane` **senza** `format` sullo stesso file deve continuare a mostrare il JSON grezzo (prova di non-regressione).
