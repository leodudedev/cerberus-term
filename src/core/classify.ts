// Risk classifier for a pending permission. Returns an icon shown before the
// command in the Telegram message. Priority: danger > caution > safe.

export type Risk = "safe" | "caution" | "danger";

export const RISK_ICON: Record<Risk, string> = {
  safe: "🟢",
  caution: "🟡",
  danger: "🔴",
};

export const RISK_RANK: Record<Risk, number> = {
  safe: 0,
  caution: 1,
  danger: 2,
};

// Patterns scanned against the whole command string (covers pipes and && chains).
const DANGER: RegExp[] = [
  // rm only in command position (start, after ;&|, or via sudo/xargs/exec) so
  // "pnpm rm pkg" or a quoted "rm old code" don't trip it.
  /(^|[;&|]\s*|\b(?:sudo|xargs|exec)\s+)rm\b/,
  /\bsudo\b/,
  /\bdd\b/,
  /\bmkfs\w*/,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bkillall\b/,
  /\bchmod\s+-?R?\s*0*777\b/,
  /\bchown\s+-R\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-z]*f/,
  // --force only within a git segment; e.g. "pnpm install --force" stays caution
  /\bgit\b[^;&|]*--force\b|\bgit\b[^;&|]*\bpush\b[^;&|]*\s-f\b/,
  /\b(truncate|fdisk|format)\b/,
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/, // pipe to shell
  /\beval\b/,
  />\s*\/(dev|etc|sys|boot)\b/, // redirect into system paths
  /:\s*\(\s*\)\s*\{/, // fork bomb
];

const CAUTION: RegExp[] = [
  /\b(mv|cp|chmod|chown|ln|mkdir|touch|kill)\b/,
  /\bsed\s+-i\b/,
  /\bgit\s+(commit|push|rebase|merge|checkout|stash|cherry-pick)\b/,
  /\b(npm|pnpm|yarn|composer|pip|pip3|brew|npx|cargo|gem)\s+(install|add|remove|rm|un|uninstall|unlink|update|upgrade|i)\b/,
  /\b(curl|wget|scp|rsync|ssh|docker|systemctl|launchctl)\b/,
  /\bmysql\b|\bpsql\b|\bredis-cli\b|\bwp\s+db\b/,
];

const SAFE: RegExp[] = [
  /^\s*(cat|ls|cd|pwd|echo|printf|grep|rg|find|head|tail|wc|which|tree|less|more|file|stat|env|date|whoami|hostname|uname|df|du|ps|top)\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|blame)\b/,
  /^\s*(node|npm|pnpm|yarn|python3?|php|tsc)\s+(-v|--version)\b/,
];

export function classifyCommand(command: string): Risk {
  const c = command.trim();
  if (!c) return "caution";
  if (DANGER.some((r) => r.test(c))) return "danger";
  if (SAFE.some((r) => r.test(c))) return "safe";
  if (CAUTION.some((r) => r.test(c))) return "caution";
  return "safe"; // plain read-only-ish command with no flagged token
}

// Risk for non-shell tools, classified by tool name.
export function classifyTool(tool: string): Risk {
  switch (tool) {
    case "Read":
    case "Glob":
    case "Grep":
    case "NotebookRead":
      return "safe";
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
    case "WebFetch":
    case "WebSearch":
      return "caution";
  }
  // Copilot CLI tool names are lowercase and not a fixed set: fall back to a
  // read-vs-write heuristic on the name.
  if (/^(read|view|glob|grep|search|list|fetch|get|cat|ls)/i.test(tool)) return "safe";
  return "caution";
}

// Tools whose input is a shell command: route them through classifyCommand.
// "Bash" is Claude Code; the lowercase names cover Copilot CLI variants.
const SHELL_TOOLS = /^(bash|shell|powershell|terminal|run_in_terminal|exec(ute)?_?\w*)$/i;

export function riskFor(tool: string, command: string): Risk {
  return SHELL_TOOLS.test(tool) && command ? classifyCommand(command) : classifyTool(tool);
}
