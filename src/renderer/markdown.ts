import { marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';

// Markdown -> sanitized HTML for the document viewer. Nothing here trusts the
// source: a repo's README is other people's text, and it lands in the same
// renderer that owns the terminals. marked builds the HTML, DOMPurify decides
// what survives, and the two heavy extras (syntax highlighting, mermaid) are
// dynamic imports so they only cost anything on a document that uses them.

const MERMAID_LANG = /^mermaid$/i;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// GitHub-style anchor, so `#some-heading` links inside a document resolve.
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, '-');
}

function buildRenderer(): Renderer {
  const renderer = new Renderer();

  // Mermaid blocks are held as their source and rendered after sanitizing:
  // mermaid draws an SVG, and an SVG built before DOMPurify runs is an SVG
  // DOMPurify would strip half of.
  //
  // The source rides as the element's text, not as a data- attribute: DOMPurify
  // drops any attribute whose decoded value contains markup, and a diagram with
  // a `<br/>` in a node label (which is idiomatic mermaid) hits exactly that.
  renderer.code = ({ text, lang }) => {
    const language = (lang ?? '').trim().split(/\s+/)[0] ?? '';
    if (MERMAID_LANG.test(language)) {
      // `pending` hides the source until it has been drawn (or has failed).
      return `<div class="md-mermaid pending">${escapeHtml(text)}</div>`;
    }
    const attr = language ? ` data-lang="${escapeHtml(language)}"` : '';
    return `<pre class="md-pre"><code${attr}>${escapeHtml(text)}</code></pre>`;
  };

  renderer.heading = ({ tokens, depth }) => {
    const inner = renderer.parser.parseInline(tokens);
    return `<h${depth} id="${escapeHtml(slugify(inner))}">${inner}</h${depth}>`;
  };

  // Task lists come out of GFM as checkboxes; they'd be interactive and
  // pointless in a read-only viewer.
  renderer.checkbox = ({ checked }) => `<span class="md-task">${checked ? '☑' : '☐'}</span>`;

  return renderer;
}

// A relative <img src> would resolve against the renderer's own file:// URL and
// 404 before the viewer gets a chance to inline it, so it is parked on a data-
// attribute here and restored (as a data: URL) by the viewer.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName !== 'IMG') return;
  const el = node as Element;
  const src = el.getAttribute('src');
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) return;
  el.setAttribute('data-md-src', src);
  el.removeAttribute('src');
});

const PURIFY_CONFIG = {
  ADD_ATTR: ['data-lang', 'data-md-src', 'target'],
  // The viewer resolves relative links itself; nothing else may load.
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['srcset', 'formaction', 'style']
};

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, {
    async: false,
    gfm: true,
    renderer: buildRenderer()
  });
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}

// Colour the code blocks. Lazy because highlight.js's common bundle is larger
// than everything else in the renderer put together, and a document with no
// fenced code never pays for it.
export async function highlightCode(container: HTMLElement): Promise<void> {
  const blocks = container.querySelectorAll<HTMLElement>('pre.md-pre > code[data-lang]');
  if (blocks.length === 0) return;
  try {
    const hljs = (await import('highlight.js/lib/common')).default;
    for (const block of blocks) {
      const lang = block.dataset['lang'] ?? '';
      if (!hljs.getLanguage(lang)) continue; // unknown fence tag: leave it plain
      const { value } = hljs.highlight(block.textContent ?? '', { language: lang });
      block.innerHTML = value;
      block.classList.add('hljs');
    }
  } catch (e) {
    console.error('[markdown] highlight unavailable', e);
  }
}

let mermaidReady: Promise<typeof import('mermaid').default> | null = null;

// Same lazy deal, and a much bigger dependency: only a document with a mermaid
// fence loads it. The theme is passed per render so a diagram drawn in dark mode
// and re-read in light mode isn't unreadable.
export async function renderMermaid(container: HTMLElement, dark: boolean): Promise<void> {
  // Every block, not just the undrawn ones: a theme switch re-renders, and a
  // diagram already on screen is exactly the one that has the wrong colours.
  const blocks = container.querySelectorAll<HTMLElement>('.md-mermaid');
  if (blocks.length === 0) return;
  const reveal = (): void => blocks.forEach((b) => b.classList.remove('pending'));

  if (!mermaidReady) mermaidReady = import('mermaid').then((m) => m.default);
  let mermaid;
  try {
    mermaid = await mermaidReady;
  } catch (e) {
    console.error('[markdown] mermaid unavailable', e);
    reveal(); // no renderer: show the diagram source rather than a blank gap
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    // 'strict' keeps mermaid's own sanitizer on: the diagram source is part of
    // the untrusted document.
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    fontFamily: 'system-ui, sans-serif'
  });

  let seq = 0;
  for (const block of blocks) {
    const src = block.dataset['src'] ?? block.textContent ?? '';
    if (!src.trim()) continue;
    // Kept for the re-render a theme switch triggers: by then the element holds
    // an SVG, not the source it was drawn from.
    block.dataset['src'] = src;
    try {
      const { svg } = await mermaid.render(`md-mermaid-${Date.now().toString(36)}-${seq++}`, src);
      block.innerHTML = svg;
      block.classList.add('rendered');
      block.classList.remove('md-mermaid-error');
    } catch (e) {
      // A broken diagram is a normal state of a document being written; show the
      // source instead of an empty hole.
      block.classList.add('md-mermaid-error');
      block.textContent = `mermaid: ${(e as Error).message}\n\n${src}`;
    }
    block.classList.remove('pending');
  }
}
