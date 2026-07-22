// Favorites list overlay (same modal pattern as SettingsEditor). Clicking a
// row hands its path back to the caller (which cds the owning pane) and closes.

import { loadFavorites, removeFavorite } from './favorites.js';

let isOpen = false;

export function openFavoritesOverlay(onSelect: (path: string) => void): void {
  if (isOpen) return;
  isOpen = true;

  const overlay = document.createElement('div');
  overlay.className = 'config-overlay';
  const modal = document.createElement('div');
  modal.className = 'config-modal favorites-modal';

  const title = document.createElement('div');
  title.className = 'settings-title';
  title.textContent = 'Favorites';

  const list = document.createElement('div');
  list.className = 'favorites-list';

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    isOpen = false;
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const renderList = (): void => {
    list.replaceChildren();
    const favs = loadFavorites();
    if (favs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'settings-hint';
      empty.textContent = 'No favorites yet — star a pane to add one.';
      list.append(empty);
      return;
    }
    for (const path of favs) {
      const row = document.createElement('div');
      row.className = 'favorites-row';

      const label = document.createElement('span');
      label.className = 'favorites-path';
      label.textContent = path;
      label.title = path;

      // Hover-revealed remove control (kept out of the resting visual so the
      // list stays clean, but favorites remain removable without cd-ing back).
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'favorites-remove';
      remove.textContent = '✕';
      remove.title = 'Remove from favorites';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFavorite(path);
        renderList();
      });

      row.append(label, remove);
      row.addEventListener('click', () => {
        onSelect(path);
        close();
      });
      list.append(row);
    }
  };
  renderList();

  modal.append(title, list);
  overlay.append(modal);
  document.body.append(overlay);

  document.addEventListener('keydown', onKey);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });
}
