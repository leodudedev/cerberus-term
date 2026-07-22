// Favorite paths, shared across panes/windows via localStorage (same pattern
// as persistence.ts — a pure renderer-local concern, no IPC needed).

const KEY = 'cerberus.favorites';

export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? data.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function save(paths: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(paths));
  } catch {
    /* quota — best effort */
  }
}

export function isFavorite(path: string): boolean {
  return loadFavorites().includes(path);
}

// Toggle path in/out of favorites; returns the new membership state.
export function toggleFavorite(path: string): boolean {
  const favs = loadFavorites();
  const idx = favs.indexOf(path);
  if (idx === -1) {
    favs.push(path);
    save(favs);
    return true;
  }
  favs.splice(idx, 1);
  save(favs);
  return false;
}

export function removeFavorite(path: string): void {
  save(loadFavorites().filter((p) => p !== path));
}
