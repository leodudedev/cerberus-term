// Per-project icon shown in place of the generic bell: recognize the session
// at a glance. Keyword match on the folder name first; otherwise a
// deterministic hash picks from the palette (same folder = same icon).

const KEYWORDS: [RegExp, string][] = [
  [/orario|time|clock|calend/, "⏰"],
  [/bot\b|robot/, "🤖"],
  [/trade|trading|borsa|stock/, "📈"],
  [/sol(e|ar)?\b|sun/, "☀️"],
  [/vision|photo|img|image/, "👁️"],
  [/alert|monitor|watch/, "🚨"],
  [/wp|wordpress|press|blog/, "📰"],
  [/shop|store|commerce|cart/, "🛒"],
  [/pay|bank|fin(ance)?|billing/, "💳"],
  [/mail|newsletter|smtp/, "✉️"],
  [/report|analytic|dashboard|stats/, "📊"],
  [/api\b|backend|server/, "🔌"],
  [/app\b|mobile|native|ios|android/, "📱"],
  [/web|site|www|frontend/, "🌐"],
  [/doc|wiki|book|guide/, "📚"],
  [/test|demo|sandbox|playground/, "🧪"],
  [/ai\b|ml\b|gpt|claude|llm/, "🧠"],
  [/game|gioco/, "🎮"],
  [/music|audio|sound/, "🎵"],
  [/video|stream/, "🎬"],
  [/crypto|coin|nft/, "🪙"],
  [/meteo|weather/, "⛅"],
  [/casa|home|domot/, "🏠"],
  [/auto|car\b|moto/, "🚗"],
  [/food|ristorant|menu|cucina/, "🍕"],
  [/hotel|booking|travel|viagg/, "🛎️"],
  [/cli\b|term|shell|tty/, "⌨️"],
];

const PALETTE = [
  "🦊", "🐙", "🦉", "🐳", "🦁", "🐸", "🦄", "🐝", "🦋", "🐢",
  "🦀", "🐬", "🦜", "🦈", "🐺", "🐯", "🐨", "🦅", "🐞", "🦕",
  "🎯", "🎲", "🎸", "🚀", "🛰️", "⚙️", "🔮", "💎", "🌋", "🌵",
];

export function iconForProject(folder: string): string {
  const n = folder.toLowerCase();
  for (const [re, icon] of KEYWORDS) if (re.test(n)) return icon;
  let h = 0;
  for (const c of n) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
