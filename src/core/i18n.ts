// Telegram-facing strings only. Text that originates from the CLI (the
// assistant's recap, the tool command) is passed through untouched — it's
// already in whatever language the session speaks. Default English; set
// CERBERUS_LANG=it for Italian.

type Lang = "en" | "it";

// Resolved at CALL time, not import time: the in-app Settings language is
// applied to the env (applySettingsToEnv) only after this module is imported,
// so a value captured here would always be stale.
function langNow(): Lang {
  return (process.env.CERBERUS_LANG ?? "").toLowerCase().startsWith("it") ? "it" : "en";
}

const strings = {
  en: {
    // Inline-keyboard buttons
    btnApprove: "✅ Approve",
    btnAlways: "♾️ Always",
    btnDeny: "❌ Deny",
    btnEsc: "⎋ Esc",
    btnCancel: "⎋ Cancel",
    // Handled-message markers
    markApproved: "✅ Approved",
    markAlways: "♾️ Always",
    markDenied: "❌ Denied",
    markCancelled: "⎋ Cancelled",
    markHandledLocal: "💻 Handled on PC",
    markOption: (n: string) => `✅ Option ${n}`,
    // Callback toasts
    handled: "Already handled",
    noSession: "Session not found",
    expired: "Expired — request too old",
    stale: "Outdated — this request was already answered or replaced",
    notDelivered: "Not delivered — the pane changed, check it on the computer",
    paneDead: (p: string) => `Pane ${p} not active`,
    paneBusy: (proc: string) => `Refused — the pane is running ${proc}, not the agent`,
    paneBusyReply: (proc: string) =>
      `⛔ Not delivered: the pane is running ${proc}, not the agent. The text would have gone to that program instead.`,
    // Commands
    noSessionToMute: "No session to mute",
    badDuration: "Invalid duration (e.g. 30m, 2h, 1d)",
    muted: (name: string, dur: string) => `🔇 ${name} — muted ${dur}`,
    muteFor: (arg: string) => `for ${arg}`,
    muteForever: "indefinitely",
    noSession2: "No session",
    unmuted: (name: string) => `🔔 ${name} — re-enabled`,
    wasNotMuted: "Wasn't muted",
    noMutedProjects: "No muted projects",
    mutedEntry: (name: string, when: string) => `🔇 ${name} → ${when}`,
    noKnownSession: "No session has notified this chat yet",
    replyUnknown:
      "⛔ Not delivered: I can't tell which session that message belongs to. Reply to a notification, or send a plain message to reach the last session notified here.",
    sentTo: (profile: string) => `→ sent to ${profile}`,
  },
  it: {
    btnApprove: "✅ Approva",
    btnAlways: "♾️ Sempre",
    btnDeny: "❌ Nega",
    btnEsc: "⎋ Esc",
    btnCancel: "⎋ Annulla",
    markApproved: "✅ Approvato",
    markAlways: "♾️ Sempre",
    markDenied: "❌ Negato",
    markCancelled: "⎋ Annullato",
    markHandledLocal: "💻 Gestito sul PC",
    markOption: (n: string) => `✅ Opzione ${n}`,
    handled: "Già gestito",
    noSession: "Sessione non trovata",
    expired: "Scaduto — richiesta troppo vecchia",
    stale: "Superato — richiesta già gestita o sostituita",
    notDelivered: "Non inviato — la pane è cambiata, controlla sul computer",
    paneDead: (p: string) => `Pane ${p} non attivo`,
    paneBusy: (proc: string) => `Rifiutato — nella pane gira ${proc}, non l'agente`,
    paneBusyReply: (proc: string) =>
      `⛔ Non inviato: nella pane gira ${proc}, non l'agente. Il testo sarebbe finito a quel programma.`,
    noSessionToMute: "Nessuna sessione da mutare",
    badDuration: "Durata non valida (es. 30m, 2h, 1d)",
    muted: (name: string, dur: string) => `🔇 ${name} — muto ${dur}`,
    muteFor: (arg: string) => `per ${arg}`,
    muteForever: "a tempo indeterminato",
    noSession2: "Nessuna sessione",
    unmuted: (name: string) => `🔔 ${name} — riattivato`,
    wasNotMuted: "Non era mutato",
    noMutedProjects: "Nessun progetto mutato",
    mutedEntry: (name: string, when: string) => `🔇 ${name} → ${when}`,
    noKnownSession: "Nessuna sessione ha ancora notificato questa chat",
    replyUnknown:
      "⛔ Non inviato: non so a quale sessione appartiene quel messaggio. Rispondi a una notifica, oppure manda un messaggio normale per raggiungere l'ultima sessione notificata qui.",
    sentTo: (profile: string) => `→ inviato a ${profile}`,
  },
} as const;

// Proxy so every property access re-resolves the current language.
export const t = new Proxy({} as (typeof strings)["en"], {
  get: (_t, prop: string | symbol) =>
    strings[langNow()][prop as keyof (typeof strings)["en"]],
});

// Locale for time formatting, matched to the current language.
export function timeLocale(): string {
  return langNow() === "it" ? "it-IT" : "en-GB";
}
