// Image bytes handed to the document viewer, local or fetched. Kept free of
// Electron so the limits can be exercised without a running app.

// Images are inlined as base64, which costs a third again in size — a repo
// screenshot fits, a design PSD export doesn't need to.
export const MAX_ASSET_BYTES = 8_000_000;
export const ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
};

// A few compressed KB can declare a canvas that decodes to hundreds of MB
// (10000×10000 RGBA is ~381 MiB), so the byte caps alone don't bound what the
// renderer allocates. 32 MPx is a 7680×4320 screenshot with room to spare.
export const MAX_IMAGE_PIXELS = 32 * 1024 * 1024;

// Width × height as declared in the header, read from the bytes themselves
// (a server's content-type can lie). Null when the format isn't one we parse
// — AVIF, SVG (rasterised at its layout size) — or the header is malformed.
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  // PNG: signature, then IHDR as the first chunk.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF: logical screen size.
  if (buf.length >= 10 && buf.toString('latin1', 0, 4) === 'GIF8') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // WebP: lossy, lossless and extended layouts each keep the size elsewhere.
  if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    return null;
  }
  // JPEG: walk the segments to the first start-of-frame.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      if (marker === 0xff) {
        i++; // fill byte
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2; // standalone markers carry no length
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// Rejects only what is known to be too large; an unparsed size passes.
export function withinPixelLimit(buf: Buffer): boolean {
  const size = imageSize(buf);
  return !size || size.width * size.height <= MAX_IMAGE_PIXELS;
}

// A README's badge row points at shields.io and friends. The renderer's CSP
// blocks anything remote, so main fetches the bytes and hands back a data: URL.
// Node's fetch, not Electron's net: nothing here rides on the browser session,
// so no cookie of the user's is ever attached to a request a document asked for.
// Only reached when the viewer's toggle is on — see DocsSettings.remoteImages.
const REMOTE_TIMEOUT_MS = 6000;
export const MAX_REMOTE_BYTES = 2_000_000;
const REMOTE_TYPES = new Set(Object.values(ASSET_TYPES));

// The body counted as it arrives: Content-Length can be missing or wrong (and
// describes the compressed transfer anyway), so the cap is enforced on the
// bytes actually received, and the download is cancelled the moment it's hit.
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Buffer | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, total);
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function fetchRemoteImage(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // https only: a plain-http badge would leak the request in clear and is not
  // worth downgrading the connection for.
  if (parsed.protocol !== 'https:') return null;

  try {
    const res = await fetch(parsed, {
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
      redirect: 'follow',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'image/*' }
    });
    const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    const declared = Number(res.headers.get('content-length'));
    if (!res.ok || !type || !REMOTE_TYPES.has(type) || (Number.isFinite(declared) && declared > MAX_REMOTE_BYTES)) {
      // Not read, so release the connection instead of leaving it to GC.
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const buf = await readCapped(res.body, MAX_REMOTE_BYTES);
    if (!buf || !withinPixelLimit(buf)) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null; // offline, timed out, TLS, DNS — the document keeps its chip
  }
}
