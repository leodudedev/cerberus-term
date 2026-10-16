import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_IMAGE_PIXELS,
  MAX_REMOTE_BYTES,
  fetchRemoteImage,
  imageSize,
  readCapped,
  withinPixelLimit
} from '../src/main/doc-images.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

// A body that produces `total` bytes in 64 KiB pieces on demand and records how
// far it was read and whether the consumer cancelled it.
function body(total: number, prefix: Buffer = Buffer.alloc(0)) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= total) return controller.close();
      const n = Math.min(64 * 1024, total - state.pulled);
      const chunk = Buffer.alloc(n);
      if (state.pulled === 0) prefix.copy(chunk);
      state.pulled += n;
      controller.enqueue(new Uint8Array(chunk));
    },
    cancel() {
      state.cancelled = true;
    }
  });
  return { stream, state };
}

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function respond(stream: ReadableStream<Uint8Array>, headers: Record<string, string>, status = 200) {
  const fetchMock = vi.fn(async () => new Response(stream, { status, headers }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('readCapped', () => {
  it('stops reading and cancels the body once the cap is passed', async () => {
    const { stream, state } = body(3_000_000);
    expect(await readCapped(stream, MAX_REMOTE_BYTES)).toBeNull();
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThanOrEqual(MAX_REMOTE_BYTES + 2 * 64 * 1024);
  });

  it('returns the whole body when it fits', async () => {
    const { stream } = body(100_000);
    expect((await readCapped(stream, MAX_REMOTE_BYTES))?.byteLength).toBe(100_000);
  });
});

describe('fetchRemoteImage', () => {
  it('rejects an oversized body that declares no Content-Length, without reading it all', async () => {
    const { stream, state } = body(3_000_000, png(16, 16));
    respond(stream, { 'content-type': 'image/png' });
    expect(await fetchRemoteImage('https://example.invalid/a.png')).toBeNull();
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(3_000_000);
  });

  it('does not trust a Content-Length smaller than the body', async () => {
    const { stream, state } = body(3_000_000, png(16, 16));
    respond(stream, { 'content-type': 'image/png', 'content-length': '1000' });
    expect(await fetchRemoteImage('https://example.invalid/a.png')).toBeNull();
    expect(state.cancelled).toBe(true);
  });

  it('cancels without reading when the declared size, status or type is wrong', async () => {
    for (const [headers, status] of [
      [{ 'content-type': 'image/png', 'content-length': '5000000' }, 200],
      [{ 'content-type': 'image/png' }, 404],
      [{ 'content-type': 'text/html' }, 200]
    ] as const) {
      const { stream, state } = body(500_000, png(16, 16));
      respond(stream, headers, status);
      expect(await fetchRemoteImage('https://example.invalid/a.png')).toBeNull();
      expect(state.cancelled).toBe(true);
      expect(state.pulled).toBeLessThanOrEqual(2 * 64 * 1024);
    }
  });

  it('inlines an image within limits that declares no Content-Length', async () => {
    const { stream } = body(50_000, png(64, 32));
    respond(stream, { 'content-type': 'image/png' });
    expect(await fetchRemoteImage('https://example.invalid/a.png')).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects an image whose declared canvas is too large to decode', async () => {
    const { stream } = body(1000, png(10_000, 10_000));
    respond(stream, { 'content-type': 'image/png' });
    expect(await fetchRemoteImage('https://example.invalid/bomb.png')).toBeNull();
  });

  it('gives up cleanly when the download is aborted mid-body', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(png(16, 16)));
        controller.error(new DOMException('timed out', 'TimeoutError'));
      }
    });
    respond(stream, { 'content-type': 'image/png' });
    expect(await fetchRemoteImage('https://example.invalid/a.png')).toBeNull();
  });

  it('never fetches plain http', async () => {
    const fetchMock = respond(body(10).stream, { 'content-type': 'image/png' });
    expect(await fetchRemoteImage('http://example.invalid/a.png')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('imageSize', () => {
  it('reads PNG, GIF, WebP and JPEG headers', () => {
    expect(imageSize(png(640, 480))).toEqual({ width: 640, height: 480 });

    const gif = Buffer.alloc(13);
    gif.write('GIF89a', 0, 'latin1');
    gif.writeUInt16LE(320, 6);
    gif.writeUInt16LE(200, 8);
    expect(imageSize(gif)).toEqual({ width: 320, height: 200 });

    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0, 'latin1');
    webp.write('WEBP', 8, 'latin1');
    webp.write('VP8X', 12, 'latin1');
    webp.writeUIntLE(1919, 24, 3);
    webp.writeUIntLE(1079, 27, 3);
    expect(imageSize(webp)).toEqual({ width: 1920, height: 1080 });

    // SOI, an APP0 segment, then SOF0 with height 600 / width 800.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 800, height: 600 });
  });

  it('lets formats it cannot size through, and stops oversized ones', () => {
    expect(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(withinPixelLimit(Buffer.from('<svg/>'))).toBe(true);
    expect(withinPixelLimit(png(7680, 4320))).toBe(true);
    expect(withinPixelLimit(png(MAX_IMAGE_PIXELS, 2))).toBe(false);
  });
});
