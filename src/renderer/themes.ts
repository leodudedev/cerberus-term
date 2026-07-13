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

export function resolve(pref: ThemePref): Theme {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function xtermTheme(theme: Theme): ITheme {
  return theme === 'light'
    ? { background: '#f5f5f5', foreground: '#1a1a1a', cursor: '#2f7d63', selectionBackground: '#cfe6dc' }
    : { background: '#1a1a1a', foreground: '#e0e0e0', cursor: '#4a9d7f', selectionBackground: '#2b3a34' };
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
