// The Worker's image encoder: OffscreenCanvas →
// WebP, JPEG for an opaque picture where WebP encoding is missing (Safari),
// declined for a transparent one. Node has no canvas, so the browser API is
// stubbed here; the real encode runs in the browser e2e.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const r = await esbuild.build({
  entryPoints: [path.join(HERE, '../src/platform/image-encoder.ts')],
  bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'error',
});
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'airp-ie-')), 'ie.mjs');
fs.writeFileSync(tmp, r.outputFiles[0].text);
const m = await import(pathToFileURL(tmp).href);

const OPTS = { width: 0, height: 0, maxEdge: 1024, format: 'webp', quality: 80, alphaQuality: 90, alpha: false };

function stubCanvas({ encodes = ['image/webp', 'image/jpeg', 'image/png'], bitmap = { width: 3000, height: 1500 } } = {}) {
  const log = { draws: [], blobs: [], closed: 0 };
  globalThis.createImageBitmap = async (blob, options) => { log.decode = { size: blob.size, options }; return { ...bitmap, close: () => { log.closed++; } }; };
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; log.canvas = [w, h]; }
    getContext(kind, o) { log.context = o; return { drawImage: (...a) => log.draws.push(a.slice(1)), set imageSmoothingQuality(v) { log.smoothing = v; }, set imageSmoothingEnabled(v) {} }; }
    async convertToBlob({ type, quality }) { log.blobs.push([type, quality]); return new Blob([new Uint8Array([1, 2, 3])], { type: encodes.includes(type) ? type : 'image/png' }); }
  };
  return log;
}

test('no canvas in this environment → null (the original is kept)', async () => {
  delete globalThis.OffscreenCanvas;
  delete globalThis.createImageBitmap;
  assert.equal(await m.offscreenImageEncoder.encode(new Uint8Array(4), OPTS), null);
});

test('fits the oriented picture inside maxEdge and encodes WebP at the given quality', async () => {
  const log = stubCanvas();
  const out = await m.offscreenImageEncoder.encode(new Uint8Array(10), OPTS);
  assert.deepEqual(out.mimeType, 'image/webp');
  assert.deepEqual(log.canvas, [1024, 512]);
  assert.deepEqual(log.draws, [[0, 0, 1024, 512]]);
  assert.deepEqual(log.blobs, [['image/webp', 0.8]]);
  assert.equal(log.decode.options.imageOrientation, 'from-image');
  assert.equal(log.smoothing, 'high');
  assert.equal(log.closed, 1);
  assert.deepEqual(m.fitInside(800, 600, 1024), { width: 800, height: 600 }, 'never upscales');
});

test('no WebP encoding (Safari): an opaque picture falls back to JPEG, a transparent one is declined', async () => {
  stubCanvas({ encodes: ['image/jpeg', 'image/png'] });
  const opaque = await m.offscreenImageEncoder.encode(new Uint8Array(10), OPTS);
  assert.equal(opaque.mimeType, 'image/jpeg');
  stubCanvas({ encodes: ['image/jpeg', 'image/png'] });
  assert.equal(await m.offscreenImageEncoder.encode(new Uint8Array(10), { ...OPTS, alpha: true }), null);
});

test('installImageEncoder puts it where @airp/shared looks', () => {
  m.installImageEncoder();
  assert.equal(globalThis.__airpImageEncoder, m.offscreenImageEncoder);
  delete globalThis.__airpImageEncoder;
});
