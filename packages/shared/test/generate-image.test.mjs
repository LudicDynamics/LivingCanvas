import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ActionError,
  GENERATED_ASSET_DIR,
  assetSlug,
  createActionService,
  generateImage,
  outputPathFor,
  requestKey,
  registerImageProviderFactory,
  resetImageProviderForTests,
  resolveImageProvider,
} from '../dist/index.js';

// ------------------------------------------------------------------ pure funcs

test('assetSlug: kebab-case, ASCII degradation, 32-char cap (doc 11 §10.1)', () => {
  assert.equal(assetSlug('Baker Street at Dusk!'), 'baker-street-at-dusk');
  assert.equal(assetSlug('雨夜'), 'image');
  assert.equal(assetSlug('!!!'), 'image');
  assert.equal(assetSlug(''), 'image');
  const long = 'a'.repeat(40) + ' tail';
  const slug = assetSlug(long);
  assert.equal(slug.length, 32);
  assert.ok(!slug.endsWith('-'), 'no trailing dash');
});

test('requestKey: stable per field, 16 hex, every field participates (doc 11 §10.1)', () => {
  const base = { caption: 'c', model: 'm', width: 1024, height: 1024 };
  const key = requestKey(base);
  assert.equal(key, requestKey({ ...base }));
  assert.equal(key.length, 16);
  assert.match(key, /^[0-9a-f]{16}$/);
  // One assertion per field so a forgotten field in the hash cannot slip through.
  assert.notEqual(key, requestKey({ ...base, caption: 'c2' }));
  assert.notEqual(key, requestKey({ ...base, model: 'm2' }));
  assert.notEqual(key, requestKey({ ...base, width: 1025 }));
  assert.notEqual(key, requestKey({ ...base, height: 1025 }));
  assert.notEqual(key, requestKey({ ...base, reference: '.airpworld/assets/a.png' }));
});

test('outputPathFor: prefix + ext + no traversal (doc 11 §10.1)', () => {
  const out = outputPathFor({ caption: 'Fog over Baker Street', model: 'm', width: 1, height: 1, mimeType: 'image/webp' });
  assert.ok(out.asset.startsWith(`${GENERATED_ASSET_DIR}/fog-over-baker-street-`), out.asset);
  assert.ok(out.asset.endsWith('.webp'), out.asset);
  assert.ok(!out.asset.includes('..'), out.asset);
  assert.equal(GENERATED_ASSET_DIR, '.airpworld/assets/gen');
  assert.equal(outputPathFor({ caption: 'p', model: 'm', width: 1, height: 1, mimeType: 'image/jpeg' }).ext, 'jpg');
  assert.equal(outputPathFor({ caption: 'p', model: 'm', width: 1, height: 1, mimeType: 'image/png' }).ext, 'png');
});

test('resolveImageProvider defaults to no_provider and resets cleanly (doc 11 §10.1)', () => {
  resetImageProviderForTests();
  assert.deepEqual(resolveImageProvider(), { provider: null, reason: 'no_provider' });
});

// ---------------------------------------------------- in-memory store + provider

/** Minimal WorldStore stub: only the three methods generate_image touches. */
function fakeStore({ files = {} } = {}) {
  const mem = new Map(Object.entries(files));
  return {
    writeCalls: [],
    async statKind(p) {
      return mem.has(p) ? 'file' : 'missing';
    },
    async readFileBase64(p) {
      if (!mem.has(p)) throw new Error(`ENOENT: ${p}`);
      return mem.get(p);
    },
    async writeFileAtomic(p, content) {
      this.writeCalls.push(p);
      mem.set(p, Buffer.isBuffer(content) ? content.toString('base64') : content);
    },
    _mem: mem,
  };
}

const PNG_B64 = Buffer.from('not-really-a-png-but-bytes').toString('base64');

function fakeProvider(overrides = {}) {
  return {
    id: 'fake',
    model: 'fake/model-1',
    supportsReference: true,
    calls: [],
    async generate(req, opts) {
      this.calls.push({ req, opts });
      return { ok: true, mimeType: 'image/png', dataB64: PNG_B64 };
    },
    ...overrides,
  };
}

const ctxFor = (store) => ({ store, actor: { type: 'writer' }, turn: 'turn:test:1' });

test('generateImage success: writes the base64 bytes, full details, reused:false', async () => {
  resetImageProviderForTests();
  const store = fakeStore();
  const provider = fakeProvider();
  registerImageProviderFactory(() => provider);

  const out = await generateImage(ctxFor(store), { prompt: 'Baker Street at dusk', style: 'sepia ink', width: 1536, height: 1024 });

  assert.equal(store.writeCalls.length, 1);
  const asset = out.details.asset;
  assert.equal(store._mem.get(asset), PNG_B64, 'bytes written match the provider base64');
  assert.ok(asset.startsWith('.airpworld/assets/gen/baker-street-at-dusk-'), asset);
  assert.equal(out.details.mimeType, 'image/png');
  assert.equal(out.details.provider, 'fake');
  assert.equal(out.details.model, 'fake/model-1');
  assert.equal(out.details.width, 1536);
  assert.equal(out.details.height, 1024);
  assert.equal(out.details.reused, false);
  assert.equal(out.details.caption, 'Baker Street at dusk, sepia ink');
  assert.equal(out.details.attachTo, undefined);
  assert.equal(out.details.event, undefined, 'no event');
  assert.ok(out.text.includes(asset), 'text carries the full asset path');
  assert.ok(typeof out.details.elapsedMs === 'number');
  // provider got the caption + requested size, plus the timeout
  assert.equal(provider.calls[0].req.prompt, 'Baker Street at dusk, sepia ink');
  assert.equal(provider.calls[0].req.width, 1536);
  assert.equal(provider.calls[0].opts.scene, 'in-progress', 'a writer call is mid-scene');
});

test('generateImage: only writer / character calls are marked mid-scene', async () => {
  for (const [type, scene] of [['character', 'in-progress'], ['player', undefined], ['god', undefined]]) {
    resetImageProviderForTests();
    const provider = fakeProvider();
    registerImageProviderFactory(() => provider);
    await generateImage({ store: fakeStore(), actor: { type }, turn: 't' }, { prompt: `scene ${type}`, width: 1024, height: 1024 });
    assert.equal(provider.calls[0].opts.scene, scene, type);
  }
});

test('generateImage is idempotent: second call reuses, writes once (doc 11 §10.2)', async () => {
  resetImageProviderForTests();
  const store = fakeStore();
  registerImageProviderFactory(() => fakeProvider());

  const input = { prompt: 'Lady Adler portrait', width: 512, height: 512 };
  const first = await generateImage(ctxFor(store), input);
  const second = await generateImage(ctxFor(store), input);

  assert.equal(second.details.asset, first.details.asset);
  assert.equal(first.details.reused, false);
  assert.equal(second.details.reused, true);
  assert.equal(store.writeCalls.length, 1, 'the write happened exactly once');
  assert.ok(second.text.includes('Reused the existing asset'));
});

test('generateImage checks the existing file BEFORE paying the provider again', async () => {
  resetImageProviderForTests();
  const store = fakeStore();
  const provider = fakeProvider();
  registerImageProviderFactory(() => provider);
  const input = { prompt: 'Lantern on the quay', width: 1024, height: 576 };
  const first = await generateImage(ctxFor(store), input);
  assert.equal(provider.calls.length, 1);
  const second = await generateImage(ctxFor(store), input);
  assert.equal(provider.calls.length, 1, 'the repeat request never reached the provider');
  assert.deepEqual([second.details.reused, second.details.asset, second.details.mimeType], [true, first.details.asset, first.details.mimeType]);
  assert.ok(second.details.bytes > 0);
});

test('default provider timeout is 150 s (medium gpt-image can exceed 60 s)', async () => {
  resetImageProviderForTests();
  const provider = fakeProvider();
  registerImageProviderFactory(() => provider);
  const saved = process.env.AIRP_IMAGE_TIMEOUT_MS;
  delete process.env.AIRP_IMAGE_TIMEOUT_MS;
  try {
    await generateImage(ctxFor(fakeStore()), { prompt: 'Timeout probe' });
    assert.equal(provider.calls[0].opts.timeoutMs, 150000);
  } finally {
    if (saved !== undefined) process.env.AIRP_IMAGE_TIMEOUT_MS = saved;
  }
});

test('generateImage with no provider fails loud: unsupported + do-not-retry text', async () => {
  resetImageProviderForTests();
  const store = fakeStore();
  await assert.rejects(
    () => generateImage(ctxFor(store), { prompt: 'anything' }),
    (e) => {
      assert.ok(e instanceof ActionError);
      assert.equal(e.code, 'unsupported');
      assert.equal(e.httpStatus, 501);
      assert.equal(e.details.reason, 'no_provider');
      assert.equal(e.details.configHint, 'Set AIRP_IMAGE_MODEL and OPENROUTER_API_KEY');
      assert.ok(e.message.includes('No image model is configured'));
      assert.ok(e.message.includes('Do not retry'));
      return true;
    }
  );
  assert.equal(store.writeCalls.length, 0, 'nothing written without a provider');
});

test('generateImage input validation throws the documented codes (doc 11 §10.1)', async () => {
  resetImageProviderForTests();
  registerImageProviderFactory(() => fakeProvider());
  const store = fakeStore({ files: { '.airpworld/assets/ref.png': PNG_B64 } });
  const ctx = ctxFor(store);
  const codeOf = async (input) => {
    try {
      await generateImage(ctx, input);
      return null;
    } catch (e) {
      assert.ok(e instanceof ActionError, `expected ActionError, got ${e}`);
      return e.code;
    }
  };
  assert.equal(await codeOf({ prompt: '' }), 'invalid_argument');
  assert.equal(await codeOf({ prompt: '   ' }), 'invalid_argument');
  assert.equal(await codeOf({ prompt: 'x'.repeat(2001) }), 'invalid_argument');
  assert.equal(await codeOf({ prompt: 'ok', width: 0 }), 'invalid_argument');
  assert.equal(await codeOf({ prompt: 'ok', width: 99999 }), 'invalid_argument');
  assert.equal(await codeOf({ prompt: 'ok', width: 512.5 }), 'invalid_argument');
  assert.equal(await codeOf({ prompt: 'ok', path: 'a.png' }), 'invalid_argument');
  assert.equal(await codeOf({ prompt: 'ok', reference: 'world/x.png' }), 'invalid_path');
  assert.equal(await codeOf({ prompt: 'ok', path: 'world/nope/README.md' }), 'not_found');
  assert.equal(await codeOf({ prompt: 'ok', reference: '.airpworld/assets/none.png' }), 'not_found');
  assert.equal(store.writeCalls.length, 0, 'validation failures never write');
});

test('generateImage honours `path` as attachTo without writing it (doc 11 §2.2)', async () => {
  resetImageProviderForTests();
  const store = fakeStore({ files: { 'world/baker-street/README.md': '# B' } });
  registerImageProviderFactory(() => fakeProvider());
  const out = await generateImage(ctxFor(store), { prompt: 'clue sketch', path: 'world/baker-street/README.md' });
  assert.equal(out.details.attachTo, 'world/baker-street/README.md');
  assert.deepEqual(store.writeCalls, [out.details.asset], 'only the asset was written');
});

test('generateImage passes a reference through when the model supports it', async () => {
  resetImageProviderForTests();
  const store = fakeStore({ files: { '.airpworld/assets/src.png': PNG_B64 } });
  const provider = fakeProvider();
  registerImageProviderFactory(() => provider);
  const out = await generateImage(ctxFor(store), { prompt: 'restyle', reference: '.airpworld/assets/src.png' });
  assert.equal(provider.calls[0].req.reference.dataB64, PNG_B64);
  assert.equal(provider.calls[0].req.reference.mimeType, 'image/png');
  // reference participates in the filename
  assert.equal(out.details.asset, outputPathFor({
    caption: 'restyle', model: 'fake/model-1', width: 1024, height: 1024,
    reference: '.airpworld/assets/src.png', mimeType: 'image/png',
  }).asset);
});

test('generateImage: model without image input refuses a reference (unsupported)', async () => {
  resetImageProviderForTests();
  const store = fakeStore({ files: { '.airpworld/assets/src.png': PNG_B64 } });
  registerImageProviderFactory(() => fakeProvider({ supportsReference: false }));
  await assert.rejects(
    () => generateImage(ctxFor(store), { prompt: 'restyle', reference: '.airpworld/assets/src.png' }),
    (e) => e instanceof ActionError && e.code === 'unsupported' && e.message.includes('cannot take a source image')
  );
  assert.equal(store.writeCalls.length, 0);
});

test('generateImage maps every provider failure reason to a code + text, never writes (doc 11 §10.2)', async () => {
  const cases = [
    ['timeout', 'internal', 500, 'did not answer within'],
    ['aborted', 'internal', 500, 'cancelled'],
    ['no_image', 'internal', 500, 'returned no image'],
    ['policy', 'internal', 500, 'refused this prompt'],
    ['provider_error', 'internal', 500, 'The image model failed'],
    ['no_credentials', 'unsupported', 501, 'has no API key'],
  ];
  for (const [reason, code, http, needle] of cases) {
    resetImageProviderForTests();
    const store = fakeStore();
    registerImageProviderFactory(() =>
      fakeProvider({ async generate() { return { ok: false, reason, message: 'upstream msg' }; } })
    );
    await assert.rejects(
      () => generateImage(ctxFor(store), { prompt: 'x' }),
      (e) => {
        assert.ok(e instanceof ActionError, reason);
        assert.equal(e.code, code, reason);
        assert.equal(e.httpStatus, http, reason);
        assert.equal(e.details.reason, reason, `${reason}: details.reason`);
        assert.ok(e.message.includes(needle), `${reason}: "${e.message}"`);
        return true;
      },
      reason
    );
    assert.equal(store.writeCalls.length, 0, `${reason}: nothing written`);
  }
});

test('generateImage: a provider that returns ok with empty data is no_image, not a 0-byte file', async () => {
  resetImageProviderForTests();
  const store = fakeStore();
  registerImageProviderFactory(() => fakeProvider({ async generate() { return { ok: true, mimeType: 'image/png', dataB64: '' }; } }));
  await assert.rejects(
    () => generateImage(ctxFor(store), { prompt: 'x' }),
    (e) => e instanceof ActionError && e.details.reason === 'no_image'
  );
  assert.equal(store.writeCalls.length, 0);
});

test('generateImage: abort during generate returns aborted and writes nothing (doc 11 §10.2)', async () => {
  resetImageProviderForTests();
  const store = fakeStore();
  registerImageProviderFactory(() => fakeProvider({
    async generate(req, opts) {
      // The action layer forwards the hard timeout; the abort itself is
      // observed by the provider (doc 11 §7.2 — no signal on ActionContext).
      assert.equal(typeof opts.timeoutMs, 'number');
      return { ok: false, reason: 'aborted', message: 'aborted' };
    },
  }));
  await assert.rejects(
    () => generateImage(ctxFor(store), { prompt: 'slow' }),
    (e) => e instanceof ActionError && e.details.reason === 'aborted' && e.message.includes('nothing was written')
  );
  assert.equal(store.writeCalls.length, 0);
});

test('generateImage is reachable through createActionService under the frozen name', async () => {
  resetImageProviderForTests();
  const store = fakeStore();
  registerImageProviderFactory(() => fakeProvider());
  const svc = createActionService(store, { type: 'writer' }, { turn: 'turn:test:2' });
  const out = await svc.generateImage({ prompt: 'via service' });
  assert.ok(out.details.asset.startsWith('.airpworld/assets/gen/'));
  assert.equal(out.details.event, undefined);
});

test('generateImage: unknown mime type falls back to .png (doc 11 §4.2)', async () => {
  resetImageProviderForTests();
  const store = fakeStore();
  registerImageProviderFactory(() => fakeProvider({ async generate() { return { ok: true, mimeType: 'image/avif', dataB64: PNG_B64 }; } }));
  const out = await generateImage(ctxFor(store), { prompt: 'weird mime' });
  assert.ok(out.details.asset.endsWith('.png'), out.details.asset);
});

test('generateImage writes through a real LocalWorldStore into .airpworld/assets/gen (01 §7.3 / REVIEW B-2)', async () => {
  resetImageProviderForTests();
  const fsp = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { LocalWorldStore } = await import('../dist/index.js');

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'airp-gen-test-'));
  const store = new LocalWorldStore(root);
  try {
    registerImageProviderFactory(() => fakeProvider());
    const out = await generateImage(
      { store, actor: { type: 'writer' }, turn: 'turn:test:3' },
      { prompt: 'Fog over Baker Street', style: 'sepia ink sketch' }
    );
    assert.equal(out.details.asset, `${GENERATED_ASSET_DIR}/${assetSlug(out.details.caption)}-${requestKey({ caption: out.details.caption, model: out.details.model, width: 1024, height: 1024 })}.png`);
    const onDisk = await fsp.readFile(path.join(root, out.details.asset));
    assert.equal(onDisk.toString('base64'), PNG_B64, 'the exact bytes landed on disk');
    // reuse through the real store: the file now exists, so a second call writes nothing new.
    const again = await generateImage(
      { store, actor: { type: 'writer' }, turn: 'turn:test:4' },
      { prompt: 'Fog over Baker Street', style: 'sepia ink sketch' }
    );
    assert.equal(again.details.reused, true);
    assert.deepEqual(await fsp.readdir(path.join(root, '.airpworld/assets/gen')), [path.basename(out.details.asset)]);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
