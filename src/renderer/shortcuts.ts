// Single source of truth for what the shortcuts overlay lists. Kept as data so
// the overlay stays a renderer of rows, and so a new binding is one entry here
// instead of markup somewhere.
//
// Labels are platform-resolved, not "Cmd+F (Ctrl+Shift+F)": whoever opens the
// panel is on one machine and only needs that machine's keys. The Cmd combos
// handled inside the terminal (Terminal.ts) test metaKey, which is the Windows
// key off macOS — those rows are dropped there rather than shown as a lie.

export const IS_MAC = navigator.userAgent.includes('Mac');

export interface Shortcut {
  keys: string;
  label: string;
}

export interface ShortcutGroup {
  title: string;
  hint?: string;
  items: Shortcut[];
}

const mod = IS_MAC ? 'Cmd' : 'Ctrl';
// Ctrl+C/F/V are control characters the shell owns, so off macOS those bindings
// live on Ctrl+Shift (mirrors the accelerators in main/index.ts).
const clip = IS_MAC ? 'Cmd' : 'Ctrl+Shift';

const macOnly = (items: Shortcut[]): Shortcut[] => (IS_MAC ? items : []);

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Leader (Ctrl+B, then a key)',
    hint: 'The leader arms for two seconds — Esc, or any unbound key, cancels it.',
    items: [
      { keys: '% or |', label: 'Split the focused pane right' },
      { keys: '" or -', label: 'Split the focused pane down' },
      { keys: 'x', label: 'Close the focused pane' },
      { keys: 'z', label: 'Zoom the pane to the whole tab (again to restore)' },
      { keys: 'h j k l', label: 'Move focus left / down / up / right' },
      { keys: '← ↓ ↑ →', label: 'Move focus with arrows' },
      { keys: 'H J K L', label: 'Resize the focused pane' },
      { keys: 'Shift + ← ↓ ↑ →', label: 'Resize with arrows' },
      { keys: '?', label: 'Open this panel' }
    ]
  },
  {
    title: 'Panes',
    items: [
      ...macOnly([
        { keys: 'Cmd+D', label: 'Split right' },
        { keys: 'Cmd+Shift+D', label: 'Split down' },
        { keys: 'Cmd+K', label: 'Close the focused pane' },
        { keys: 'Cmd+←  Cmd+→', label: 'Jump to start / end of the line' }
      ]),
      { keys: 'Shift+Enter', label: 'Newline without submitting' }
    ]
  },
  {
    title: 'Tabs',
    hint: 'Double-click a tab title to rename it.',
    items: [
      { keys: `${mod}+T`, label: 'New tab' },
      { keys: `${mod}+W`, label: 'Close tab' },
      { keys: `${mod}+Shift+]`, label: 'Next tab' },
      { keys: `${mod}+Shift+[`, label: 'Previous tab' },
      { keys: `${mod}+1 … ${mod}+9`, label: 'Jump to tab 1–9' }
    ]
  },
  {
    title: 'Find in pane',
    items: [
      { keys: `${clip}+F`, label: 'Open the find bar' },
      { keys: 'Enter', label: 'Next match' },
      { keys: 'Shift+Enter', label: 'Previous match' },
      { keys: 'Esc', label: 'Close the find bar' }
    ]
  },
  {
    title: 'Project docs',
    hint: "The ▤ button in a pane header lists the markdown in that pane's project.",
    items: [
      { keys: '↑ ↓', label: 'Move through the file list' },
      { keys: 'Enter', label: 'Open the selected document' },
      { keys: `${clip}+F`, label: 'Find in the open document' },
      { keys: 'Esc', label: 'Close the document (the find bar first, if open)' }
    ]
  },
  {
    title: 'App',
    items: [
      { keys: `${clip}+C`, label: 'Copy' },
      { keys: `${clip}+V`, label: 'Paste' },
      { keys: `${mod}+,`, label: 'Settings' },
      { keys: `${mod}+Shift+L`, label: 'Toggle theme' },
      { keys: IS_MAC ? 'Cmd+/' : 'Ctrl+Shift+/', label: 'Open this panel' },
      { keys: `${mod}+Shift+W`, label: 'Close the window' },
      { keys: IS_MAC ? 'Ctrl+Cmd+F' : 'F11', label: 'Fullscreen' },
      { keys: `${mod}+Q`, label: 'Quit' }
    ]
  }
];
