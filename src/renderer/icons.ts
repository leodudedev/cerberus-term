// One stroked icon set for the chrome (pane header, document toolbar).
//
// Unicode glyphs were the first cut and they don't work at this size: every
// glyph comes from a different block, so they land at different weights and
// optical sizes in the system font, and a few (the document block, the search
// magnifier) read as nothing at all. These are all drawn on the same 24-unit
// grid with the same stroke width, so a row of them lines up without per-glyph
// nudging, and they inherit `currentColor` so hover/active states still work.

const icon = (body: string, opts: { fill?: boolean } = {}): string =>
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" ' +
  `fill="${opts.fill ? 'currentColor' : 'none'}" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const STAR_PATH =
  '<path d="M12 2.6l2.95 5.98 6.6.96-4.77 4.65 1.12 6.57L12 17.66l-5.9 3.1 1.12-6.57L2.45 9.54l6.6-.96z"/>';
const HEART_PATH =
  '<path d="M20.3 5.1a5 5 0 0 0-7.07 0L12 6.33l-1.23-1.23a5 5 0 1 0-7.07 7.07L12 20.5l8.3-8.33a5 5 0 0 0 0-7.07z"/>';

export const ICONS = {
  doc: icon(
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>' +
      '<path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>'
  ),
  star: icon(STAR_PATH),
  starFilled: icon(STAR_PATH, { fill: true }),
  heart: icon(HEART_PATH),
  splitRight: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
  splitDown: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/>'),
  // Sliders, not a cog: a cog's teeth turn into a sun at 15px, and this button
  // edits a config file rather than opening a preferences window anyway.
  sliders: icon(
    '<path d="M4 7h8M17 7h3M4 17h3M12 17h8"/>' +
      '<circle cx="14.5" cy="7" r="2.5"/><circle cx="9.5" cy="17" r="2.5"/>'
  ),
  expand: icon('<path d="M15 3h6v6M9 21H3v-6M21 3l-7.5 7.5M3 21l7.5-7.5"/>'),
  collapse: icon('<path d="M14 10h6M14 10V4M10 14H4M10 14v6M14 10l7-7M3 21l7-7"/>'),
  close: icon('<path d="M18 6L6 18M6 6l12 12"/>'),
  back: icon('<path d="M15 5l-7 7 7 7"/>'),
  find: icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3L21 21"/>')
};
