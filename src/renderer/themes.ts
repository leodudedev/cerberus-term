import type { ITheme } from '@xterm/xterm';

// Light/dark theme. Pref lives in localStorage; 'system' follows the OS. DOM
// colors come from CSS vars keyed on <html data-theme>; xterm needs JS values.

export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'cerberus.theme';

export function getPref(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function setPref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
}

// Dark is the standard-terminal baseline: TUI apps (Claude Code, vim, …) assume a
// dark background and emit light foreground text, which turns invisible on a light
// terminal. So 'system' resolves to dark; light applies only when explicitly chosen.
export function resolve(pref: ThemePref): Theme {
  return pref === 'light' ? 'light' : 'dark';
}

// Full 16-color ANSI palettes. Without these, xterm.js falls back to its built-in
// palette (tuned for a dark background), so on the light theme the ANSI colors and
// dimmed text (\x1b[90m / SGR 2 faint) wash out and become unreadable — and neither
// theme matches the familiar macOS Terminal / VS Code look. The light palette is
// hand-darkened so every color keeps contrast against the #f5f5f5 background.
const darkTheme: ITheme = {
  background: '#1a1a1a',
  foreground: '#e0e0e0',
  cursor: '#4a9d7f',
  cursorAccent: '#1a1a1a',
  selectionBackground: '#2b3a34',
  // Vivid ANSI palette (VS Code-family hues) so apps that only use the 16-color
  // ANSI set don't look washed-out. Truecolor apps bypass this via COLORTERM.
  black: '#3a3a3a',
  red: '#e05561',
  green: '#22c98b',
  yellow: '#e5b95c',
  blue: '#4aa5f0',
  magenta: '#c678dd',
  cyan: '#33c5d8',
  // Claude Code's slash menu marks the matched prefix and the selected row with
  // brightWhite (SGR 97) over white (SGR 37) base — no bg, no color. Keep white a
  // clear grey so bright-white highlights actually pop instead of blending in.
  white: '#9e9e9e',
  brightBlack: '#6a7070',
  brightRed: '#ff6b7a',
  brightGreen: '#3ae3a0',
  brightYellow: '#f5cf78',
  brightBlue: '#6cb6ff',
  brightMagenta: '#d68fee',
  brightCyan: '#4fdde3',
  brightWhite: '#ffffff'
};

const lightTheme: ITheme = {
  background: '#f5f5f5',
  foreground: '#1a1a1a',
  cursor: '#2f7d63',
  cursorAccent: '#f5f5f5',
  selectionBackground: '#cfe6dc',
  black: '#2a2a2a',
  red: '#c0392b',
  green: '#2f7d63',
  yellow: '#9a7a00',
  blue: '#2e6fb0',
  magenta: '#8b3d8b',
  cyan: '#2a7d7d',
  white: '#5a5a5a',
  brightBlack: '#767676',
  brightRed: '#d0432b',
  brightGreen: '#3a9a7a',
  brightYellow: '#b08800',
  brightBlue: '#3d82c4',
  brightMagenta: '#a34da3',
  brightCyan: '#3a9a9a',
  brightWhite: '#1a1a1a'
};

export function xtermTheme(theme: Theme): ITheme {
  return theme === 'light' ? lightTheme : darkTheme;
}

// Apply a pref: set <html data-theme> and broadcast so live terminals restyle.
export function applyPref(pref: ThemePref): Theme {
  const theme = resolve(pref);
  document.documentElement.dataset['theme'] = theme;
  window.dispatchEvent(new CustomEvent<Theme>('theme-change', { detail: theme }));
  return theme;
}

// Cycle dark<->light (an explicit choice; leaves 'system' behind).
export function toggleTheme(): void {
  const next: ThemePref = resolve(getPref()) === 'dark' ? 'light' : 'dark';
  setPref(next);
  applyPref(next);
}

export function currentTheme(): Theme {
  return resolve(getPref());
}
