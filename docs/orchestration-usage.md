# Usare Cerberus per l'orchestrazione multi-sessione

Cerberus nasce come **remote control** di sessioni CLI AI (approvazioni via Telegram). Questo
documento mostra come usarlo anche come **cockpit di orchestrazione**: supervisionare un
orchestratore che lancia più worker headless, con i **gate umani sul telefono** e i worker
**visibili live** in pane read-only.

I due usi condividono la stessa infrastruttura (hook → daemon → bot Telegram; pane native con PTY):
Cerberus diventa così un tool a doppio uso — **gestione remota + gestione orchestrazione**.

---

## Modello

- **Orchestratore** = una sessione `claude` **interattiva** in una pane Cerberus. È l'unica sessione
  interattiva, quindi l'unica che chiede permessi → i suoi gate (es. merge/push) arrivano su
  **Telegram** (hook `Notification` → `POST /event` → bot) e li approvi dal telefono.
- **Worker** = `claude -p` **headless**, lanciati dall'orchestratore. Non promptano. Vanno
  **silenziati** per non spammare le notifiche, e possono essere **osservati** come pane follower.

L'orchestratore e lo script sono **agnostici**: girano anche fuori da Cerberus (senza le notifiche).
Cerberus aggiunge solo il layer di supervisione.

---

## Due accorgimenti chiave

### 1. Silenziare i worker
`resources/hooks/notify.sh` è gated su `CERBERUS_PANE_ID`. I worker lanciati dall'orchestratore
ereditano quella variabile dal padre → notificherebbero anche loro. Lanciali con la var **spenta**:
```bash
env -u CERBERUS_PANE_ID claude -p "…" --model "…" …
```
Così **solo** l'orchestratore (che mantiene la sua `CERBERUS_PANE_ID`) notifica.

### 2. Pane follower leggibili
Apri una pane read-only che segue il log di un worker (stream-json), formattato in modo leggibile:
```bash
curl -fsS -X POST "http://127.0.0.1:$CERBERUS_PORT/pane" \
  -H 'content-type: application/json' \
  -d "{\"file\":\"$PWD/out/<id>.jsonl\",\"title\":\"<id>\",\"format\":\"claude-stream\"}" || true
```
- `CERBERUS_PORT` è iniettato da Cerberus nelle sue pane (vedi `src/main/bridge-electron.ts`).
- `format:"claude-stream"` rende il JSONL leggibile (contratto in `orchestrator-panes.md` +
  `orchestrator-panes-readable.md`).
- Fuori da Cerberus `CERBERUS_PORT` non c'è → il `curl` fallisce e viene ignorato (`|| true`).

---

## Esempio bash — driver di orchestrazione

Driver minimale che cicla una tasklist, apre una pane follower per worker, li silenzia e avanza lo
stato. È deterministico (nessun giudizio AI): utile per test/mechanics o come motore invocato da una
sessione-regista.

```bash
#!/usr/bin/env bash
set -euo pipefail
Q="queue.json"
mkdir -p out work

for id in $(jq -r '.[] | select(.status=="pending") | .id' "$Q"); do
  m=$(jq -r --arg i "$id" '.[]|select(.id==$i)|.model'   "$Q")
  p=$(jq -r --arg i "$id" '.[]|select(.id==$i)|.prompt'  "$Q")
  o=$(jq -r --arg i "$id" '.[]|select(.id==$i)|.outFile' "$Q")
  log="$PWD/out/$id.jsonl"; : > "$log"

  # pane follower (best-effort; no-op fuori da Cerberus)
  if [ -n "${CERBERUS_PORT:-}" ]; then
    curl -fsS -X POST "http://127.0.0.1:$CERBERUS_PORT/pane" \
      -H 'content-type: application/json' \
      -d "{\"file\":\"$log\",\"title\":\"$id\",\"format\":\"claude-stream\"}" >/dev/null 2>&1 || true
  fi

  echo "▶ $id ($m)"
  # worker headless + silenziato + no-clarify
  env -u CERBERUS_PANE_ID claude -p "$p. Esegui e scrivi direttamente, non chiedere conferma." \
    --model "$m" --allowedTools "Write" \
    --output-format stream-json --verbose > "$log" 2>"out/$id.err"

  if [ -f "$o" ]; then
    t=$(mktemp); jq --arg i "$id" '(.[]|select(.id==$i)|.status)="done"' "$Q" > "$t" && mv "$t" "$Q"
    echo "  ✓ $id → $o"
  else
    echo "  ✗ $id: output mancante (vedi out/$id.err)"; exit 1
  fi
done
echo "Loop completato."
```

---

## Esempio tasklist — `queue.json`

```json
[
  { "id": "t1", "model": "haiku",  "prompt": "Scrivi X …",  "outFile": "work/t1.txt", "status": "pending", "dependsOn": [],      "touchesMigrations": false },
  { "id": "t2", "model": "sonnet", "prompt": "Genera Y …",  "outFile": "work/t2.txt", "status": "pending", "dependsOn": ["t1"],  "touchesMigrations": false },
  { "id": "t3", "model": "opus",   "prompt": "Analizza Z …","outFile": "work/t3.md",  "status": "pending", "dependsOn": ["t2"],  "touchesMigrations": true  }
]
```
Campi:
- `id` — identificatore del task.
- `model` — `haiku` / `sonnet` / `opus` / … (worker per-task).
- `prompt` — cosa deve fare il worker.
- `outFile` — file atteso, usato per il check di completamento.
- `status` — `pending` → `done` | `blocked`. Persistente = ripartibile se il driver crasha.
- `dependsOn` — ID che devono essere `done` prima che il task parta.
- `touchesMigrations` — se il task cambia lo schema DB (utile per un lock di esclusività lato regia).

---

## Orchestratore interattivo (review + gate umani)

Per avere **giudizio** (review del diff) e **gate umani via Telegram**, invece del driver puro si
lancia una sessione interattiva in una pane Cerberus:
```bash
claude --model opus
```
e le si dà un prompt che: legge `queue.json`, lancia i worker (come nell'esempio bash), fa la review
dell'output, e per le azioni sensibili (merge/push) chiede permesso → **Telegram** → approvi dal
telefono. In questo modo la sessione è la **regia+giudizio** e il bash è il **motore** che invoca.

---

## Note
- Contratto `POST /pane` e campo `format`: `orchestrator-panes.md`, `orchestrator-panes-readable.md`.
- Il **pattern** di orchestrazione (worktree, review gate, PR/merge, driver vs sessione) appartiene
  al progetto che lo usa; Cerberus fornisce solo **remote control + osservabilità**. Restare
  Cerberus-agnostici lato progetto è intenzionale.
