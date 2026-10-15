import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const storageKey = 'airp:performance-settings';
const legacyKey = 'airp:effects';
const balanced = {
  preset: 'balanced',
  effectsEnabled: true,
  particleDensity: 'reduced',
  shadowQuality: 'full',
  backdropBlur: 'full',
  canvasGrain: true,
  diceRendering: '3d',
  parallax: false,
  avatarMotion: 'focused',
  launcherVideo: 'hover',
};
const presets = {
  balanced,
  performance: {
    preset: 'performance', effectsEnabled: false, particleDensity: 'reduced',
    shadowQuality: 'reduced', backdropBlur: 'off', canvasGrain: false, diceRendering: 'numeric',
    parallax: false, avatarMotion: 'focused', launcherVideo: 'hover',
  },
  quality: {
    preset: 'quality', effectsEnabled: true, particleDensity: 'full',
    shadowQuality: 'full', backdropBlur: 'full', canvasGrain: true, diceRendering: '3d',
    parallax: true, avatarMotion: 'all', launcherVideo: 'autoplay',
  },
};

async function loadStore(seed = new Map()) {
  const values = new Map(seed);
  const calls = [];
  const failures = { get: new Set(), set: new Set(), remove: new Set() };
  const fakeStorage = {
    getItem(key) {
      calls.push(['get', key]);
      if (failures.get.has(key)) throw new Error(`get blocked: ${key}`);
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      calls.push(['set', key, String(value)]);
      if (failures.set.has(key)) throw new Error(`set blocked: ${key}`);
      values.set(key, String(value));
    },
    removeItem(key) {
      calls.push(['remove', key]);
      if (failures.remove.has(key)) throw new Error(`remove blocked: ${key}`);
      values.delete(key);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage });
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: false });
  const mod = await jiti.import('../src/lib/performance-settings.ts');
  return { mod, values, calls, failures };
}

const envelope = (settings, version = 2) => JSON.stringify({ version, settings });
/** A record written before envelope v2: the seven original fields only. */
const v1Fields = ({ parallax, avatarMotion, launcherVideo, ...rest }) => rest;

test('Balanced is the complete default and a normal initial read does not write', async () => {
  const { mod, calls, values } = await loadStore();
  assert.deepEqual(mod.readPerformanceSettings(), balanced);
  assert.deepEqual(mod.readPerformanceSettings(), balanced);
  assert.equal(values.has(storageKey), false);
  assert.equal(calls.filter(([kind]) => kind === 'set').length, 0);
});

test('preset setters replace the complete snapshot with each frozen profile', async () => {
  const { mod, values } = await loadStore();
  for (const preset of ['performance', 'quality', 'balanced']) {
    const expected = presets[preset];
    mod.setPerformancePreset(preset);
    assert.deepEqual(mod.readPerformanceSettings(), expected);
    assert.deepEqual(JSON.parse(values.get(storageKey)), { version: 2, settings: expected });
  }
});

test('fine-grained updates merge values and move the preset to custom', async () => {
  const { mod, values } = await loadStore();
  mod.setPerformancePreset('quality');
  mod.updatePerformanceSettings({ effectsEnabled: false, diceRendering: 'numeric' });
  const expected = { ...presets.quality, preset: 'custom', effectsEnabled: false, diceRendering: 'numeric' };
  assert.deepEqual(mod.readPerformanceSettings(), expected);
  assert.deepEqual(JSON.parse(values.get(storageKey)), { version: 2, settings: expected });
});

test('valid v2 records are accepted independent of field key order and beat legacy data', async () => {
  const custom = { ...presets.quality, preset: 'custom', canvasGrain: false };
  const reversed = Object.fromEntries(Object.entries(custom).reverse());
  const { mod, calls } = await loadStore(new Map([[storageKey, envelope(reversed)], [legacyKey, 'off']]));
  assert.deepEqual(mod.readPerformanceSettings(), custom);
  assert.equal(calls.some(([kind, key]) => kind === 'get' && key === legacyKey), false);
});

test('invalid stored records fail soft without repair or legacy fallback', async (t) => {
  const valid = { ...presets.quality, preset: 'custom' };
  const malformed = [
    ['bad JSON', '{'],
    ['unknown version', envelope(valid, 3)],
    ['v1 record carrying v2 fields', envelope(valid, 1)],
    ['missing field', JSON.stringify({ version: 2, settings: Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'canvasGrain')) })],
    ['extra field', envelope({ ...valid, surprise: true })],
    ['extra envelope field', JSON.stringify({ version: 2, settings: valid, future: true })],
    ['invalid enum', envelope({ ...valid, diceRendering: '2d' })],
    ['wrong field type', envelope({ ...valid, effectsEnabled: 'on' })],
    ['array envelope', '[]'],
    ['null settings', JSON.stringify({ version: 2, settings: null })],
  ];
  for (const [name, raw] of malformed) {
    await t.test(name, async () => {
      const { mod, values, calls } = await loadStore(new Map([[storageKey, raw], [legacyKey, 'on']]));
      assert.deepEqual(mod.readPerformanceSettings(), balanced);
      assert.equal(values.get(storageKey), raw);
      assert.equal(values.get(legacyKey), 'on');
      assert.equal(calls.some(([kind, key]) => kind === 'get' && key === legacyKey), false);
    });
  }
});

test('legacy on and off migrate by writing v1 before removing the legacy key', async (t) => {
  for (const [legacy, expected] of [['on', { ...presets.quality, preset: 'custom' }], ['off', { ...presets.quality, preset: 'custom', effectsEnabled: false }]]) {
    await t.test(legacy, async () => {
      const { mod, values, calls } = await loadStore(new Map([[legacyKey, legacy]]));
      assert.deepEqual(mod.readPerformanceSettings(), expected);
      assert.deepEqual(JSON.parse(values.get(storageKey)), { version: 2, settings: expected });
      assert.equal(values.has(legacyKey), false);
      assert.ok(calls.findIndex(([kind, key]) => kind === 'set' && key === storageKey) < calls.findIndex(([kind, key]) => kind === 'remove' && key === legacyKey));
    });
  }
});

test('migration write failure retains legacy value and keeps the migrated session snapshot', async () => {
  const { mod, values, failures } = await loadStore(new Map([[legacyKey, 'on']]));
  failures.set.add(storageKey);
  assert.deepEqual(mod.readPerformanceSettings(), { ...presets.quality, preset: 'custom' });
  assert.equal(values.get(legacyKey), 'on');
  assert.equal(values.has(storageKey), false);
});

test('localStorage read failures fail soft without attempting legacy migration', async () => {
  const { mod, failures, calls, values } = await loadStore(new Map([[legacyKey, 'on']]));
  failures.get.add(storageKey);
  assert.deepEqual(mod.readPerformanceSettings(), balanced);
  assert.equal(calls.some(([kind, key]) => kind === 'get' && key === legacyKey), false);
  assert.equal(values.has(storageKey), false);
});

test('write failures preserve the in-session update and notify subscribers once', async () => {
  const { mod, values, failures } = await loadStore(new Map([[storageKey, envelope(balanced)]]));
  let notifications = 0;
  const unsubscribe = mod.subscribePerformanceSettings(() => { notifications += 1; });
  failures.set.add(storageKey);
  mod.updatePerformanceSettings({ effectsEnabled: false });
  assert.deepEqual(mod.readPerformanceSettings(), { ...balanced, preset: 'custom', effectsEnabled: false });
  assert.equal(values.get(storageKey), envelope(balanced));
  assert.equal(notifications, 1);
  unsubscribe();
});

test('snapshot identity and subscriber notifications change only with settings', async () => {
  const { mod } = await loadStore();
  let notifications = 0;
  const unsubscribe = mod.subscribePerformanceSettings(() => { notifications += 1; });
  const first = mod.readPerformanceSettings();
  assert.equal(mod.readPerformanceSettings(), first);
  mod.setPerformancePreset('balanced');
  mod.setPerformancePreset('balanced');
  assert.equal(notifications, 0);
  mod.updatePerformanceSettings({ effectsEnabled: false });
  const changed = mod.readPerformanceSettings();
  assert.notEqual(changed, first);
  assert.equal(notifications, 1);
  mod.updatePerformanceSettings({ effectsEnabled: false });
  assert.equal(mod.readPerformanceSettings(), changed);
  assert.equal(notifications, 1);
  unsubscribe();
});

test('storage deletion failure does not undo a successful legacy migration write', async () => {
  const { mod, values, failures } = await loadStore(new Map([[legacyKey, 'off']]));
  failures.remove.add(legacyKey);
  const off = { ...presets.quality, preset: 'custom', effectsEnabled: false };
  assert.deepEqual(mod.readPerformanceSettings(), off);
  assert.deepEqual(JSON.parse(values.get(storageKey)), { version: 2, settings: off });
  assert.equal(values.get(legacyKey), 'off');
});

test('panel hooks stay above the closed-panel early return (rules of hooks)', async () => {
  // Regression: the frame-diagnostics useState was added below the
  // `if (!props.open) return null`, so mounting the panel crashed React with
  // "rendered more hooks than during the previous render" (white screen).
  // Every hook call in the component body must precede that early return.
  const source = await readFile(
    fileURLToPath(new URL('../src/components/PerformanceSettings.tsx', import.meta.url)),
    'utf8',
  );
  const earlyReturn = source.indexOf('if (!props.open');
  assert.ok(earlyReturn > -1, 'early return found');
  const hookPattern = /\b(useState|useRef|useEffect|useLayoutEffect|useMemo|useCallback|useId|useSyncExternalStore)\(/g;
  for (const match of source.matchAll(hookPattern)) {
    assert.ok(
      match.index < earlyReturn,
      `hook ${match[1]} at index ${match.index} must be declared before the closed-panel early return`,
    );
  }
});

test('new users default to Balanced with Effects on; a saved choice is never rewritten', async () => {
  const fresh = await loadStore();
  assert.equal(fresh.mod.readPerformanceSettings().effectsEnabled, true);
  assert.equal(fresh.values.has(storageKey), false, 'reading the default does not write');
  const savedOff = { ...balanced, effectsEnabled: false };
  const saved = await loadStore(new Map([[storageKey, envelope(savedOff)]]));
  assert.deepEqual(saved.mod.readPerformanceSettings(), savedOff, 'a saved choice stays as saved');
  assert.equal(saved.values.get(storageKey), envelope(savedOff));
});

test('a v1 record (before the lighter Balanced) keeps its old full behaviour and is not rewritten on read', async () => {
  const oldBalanced = { preset: 'balanced', effectsEnabled: false, particleDensity: 'full', shadowQuality: 'full', backdropBlur: 'full', canvasGrain: true, diceRendering: '3d' };
  const raw = envelope(oldBalanced, 1);
  const { mod, values, calls } = await loadStore(new Map([[storageKey, raw]]));
  assert.deepEqual(mod.readPerformanceSettings(), { ...oldBalanced, parallax: true, avatarMotion: 'all', launcherVideo: 'autoplay' });
  assert.equal(values.get(storageKey), raw);
  assert.equal(calls.filter(([kind]) => kind === 'set').length, 0);
  assert.deepEqual(v1Fields(presets.quality), { preset: 'quality', effectsEnabled: true, particleDensity: 'full', shadowQuality: 'full', backdropBlur: 'full', canvasGrain: true, diceRendering: '3d' });
});

test('Balanced is lighter than Quality; Performance keeps effects off', () => {
  assert.equal(balanced.effectsEnabled, true);
  assert.notDeepEqual({ ...balanced, preset: 'x' }, { ...presets.quality, preset: 'x' });
  assert.equal(presets.performance.effectsEnabled, false);
});

test('lighter Balanced is wired: parallax, focused portraits, hover-only world-card videos', async () => {
  const src = (rel) => readFile(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');
  const canvas = await src('components/canvas/Canvas.tsx');
  assert.match(canvas, /const parallaxOn = effectsEnabled && parallax;/);
  assert.match(canvas, /if \(vp && parallaxOn\) \{/);
  assert.match(canvas, /if \(avatarMotion === 'focused'\) return focused;/);
  const launcher = await src('components/WorldLauncher.tsx');
  assert.match(launcher, /performanceSettings\.launcherVideo === 'hover'\) return PLAYING_NONE;/);
  assert.match(launcher, /playing=\{mediaAllowed && \(active === key \|\| \(performanceSettings\.launcherVideo === 'autoplay' && playing\.has\(key\)\)\)\}/);
  const panel = await src('components/PerformanceSettings.tsx');
  for (const field of ['parallax', 'avatarMotion', 'launcherVideo']) assert.match(panel, new RegExp(`update\\('${field}'`));
});
