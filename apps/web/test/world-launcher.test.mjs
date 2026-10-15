// World launcher helpers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const launcher = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/world-launcher.ts');

const group = (id, locale, extra = {}) => ({
  id, name: `${id} · edition`, templatePath: `templates/${id}`, cover: `/api/worlds/cover?id=${id}`,
  locale, description: '', saves: [], ...extra,
});

test('editions share one entry and follow the interface language; no edition in it, no brick', () => {
  const groups = [group('wuwu', 'en'), group('wuwu-jp', 'ja'), group('wuwu-zh', 'zh-CN'), group('first-snow', 'en'), group('first-snow-jp', 'ja')];
  const worlds = (locale) => launcher.launcherWorlds(groups, locale).filter(g => !launcher.isNewWorldBrick(g)).map(g => g.id);
  assert.deepEqual(worlds('ja'), ['wuwu-jp', 'first-snow-jp']);
  assert.deepEqual(worlds('en'), ['wuwu', 'first-snow']);
  // First Snow has no Chinese edition: a Chinese player does not see it.
  assert.deepEqual(worlds('zh-CN'), ['wuwu-zh']);
  assert.equal(launcher.editionLabel('zh-CN'), '中文');
  assert.equal(launcher.editionLabel(null), 'English');
});

test('a single-language official world shows only in its language, or where the player has a save; save-only groups never', () => {
  // The Chinese-only experimental worlds (七日旅店, 漫动部, FPAL…): no English edition, no English brick.
  const inn = group('seven-days-inn-zh', 'zh-CN', { exp: true });
  const groups = [group('wuwu', 'en'), group('wuwu-zh', 'zh-CN'), inn, group('mandongbu', 'zh-CN'), group('orphan', null, { templatePath: null, cover: null })];
  const worlds = (list, locale) => launcher.launcherWorlds(list, locale).filter(g => !launcher.isNewWorldBrick(g)).map(g => g.id);
  assert.deepEqual(worlds(groups, 'en'), ['wuwu']);
  assert.deepEqual(worlds(groups, 'ja'), []);
  assert.deepEqual(worlds(groups, 'zh-CN'), ['wuwu-zh', 'seven-days-inn-zh', 'mandongbu']);
  // Hidden worlds are out of the filter chips and counts too.
  assert.deepEqual(launcher.categoryChips(launcher.launcherWorlds(groups, 'en')), [{ id: launcher.ALL_CATEGORIES, count: 1 }]);
  // The player's own play never disappears: a save in the Chinese edition keeps it on an English wall.
  const played = { ...inn, saves: [{ id: 's1', path: 'saves/s1', updatedAt: '2026-10-10T00:00:00Z', active: false }] };
  assert.deepEqual(worlds([group('wuwu', 'en'), played], 'en'), ['wuwu', 'seven-days-inn-zh']);
  // A save in one edition does not override the interface-language edition.
  assert.deepEqual(worlds([group('wuwu', 'en'), { ...group('wuwu-zh', 'zh-CN'), saves: played.saves }], 'en'), ['wuwu']);
});

test('the new-world brick leads; the author’s own made worlds next, others’ after the official ones', () => {
  const made = (id, mine, extra = {}) => group(id, 'ja', { templatePath: null, cover: `/api/worlds/cover?save=${id}`, workshop: { status: 'draft', owner: mine ? 'local' : 'other', mine, editPath: mine ? `worlds/${id}` : null }, ...extra });
  // `made-…-jp` is not an edition suffix that folds anything: ids never end in -jp.
  const groups = [group('wuwu', 'en'), made('made-0a0a0a0a', false, { templatePath: 'published/made-0a0a0a0a' }), made('made-b1b1b1b1', true)];
  const ids = launcher.launcherWorlds(groups, 'en').map(g => g.id);
  // Other people's published worlds follow the official ones.
  assert.deepEqual(ids, [launcher.NEW_WORLD_ID, 'made-b1b1b1b1', 'wuwu', 'made-0a0a0a0a']);
  // A made world (the player's own, or published by someone) shows whatever the interface language is:
  // it exists in one language only and is never hidden.
  // (Fogwharf here has only its English edition, so a Chinese wall drops it but keeps both made worlds.)
  assert.deepEqual(launcher.launcherWorlds(groups, 'zh-CN').map(g => g.id), ids.filter(id => id !== 'wuwu'));
  // A made world without a cover yet (or a play copy of an unpublished one) is not a brick.
  assert.equal(launcher.launcherWorlds([made('made-c2c2c2c2', true, { cover: null })], 'en').length, 1);
});

test('the edition suffix is dropped from the title', () => {
  assert.equal(launcher.worldTitle('霧埠の町 · 日本語'), '霧埠の町');
  assert.equal(launcher.worldTitle('Fogwharf'), 'Fogwharf');
});

test('touching bricks never show the same world, in any direction, far from the origin', () => {
  const geometry = launcher.brickGeometry(1500);
  for (const count of [5, 7, 9]) {
    const bricks = launcher.visibleBricks(-7300, 4100, 3000, 2000, geometry, 0);
    const at = new Map(bricks.map(b => [`${b.col}:${b.row}`, b]));
    for (const b of bricks) {
      const world = launcher.brickWorld(b.col, b.row, count);
      // Row neighbours, and the two bricks above/below (odd rows are shifted right).
      const shift = (b.row & 1) ? 0 : -1;
      for (const [c, r] of [[b.col + 1, b.row], [b.col + shift, b.row + 1], [b.col + shift + 1, b.row + 1]]) {
        if (!at.has(`${c}:${r}`)) continue;
        assert.notEqual(launcher.brickWorld(c, r, count), world, `count ${count}: ${b.col}:${b.row} vs ${c}:${r}`);
      }
    }
  }
});

test('the wall repeats: every world appears, including at negative coordinates', () => {
  const seen = new Set(launcher.visibleBricks(-5000, -5000, 2000, 1200, launcher.brickGeometry(1500), 0).map(b => launcher.brickWorld(b.col, b.row, 7)));
  assert.equal(seen.size, 7);
});

test('visible bricks cover the whole viewport with no holes', () => {
  const geometry = launcher.brickGeometry(1400);
  const [x, y, width, height] = [-333, 777, 1400, 800];
  const bricks = launcher.visibleBricks(x, y, width, height, geometry);
  for (let px = x; px <= x + width; px += 37) {
    for (let py = y; py <= y + height; py += 29) {
      const covered = bricks.some(b => px >= b.left - geometry.gap && px <= b.left + geometry.w + geometry.gap && py >= b.top - geometry.gap && py <= b.top + geometry.h + geometry.gap);
      assert.ok(covered, `hole at ${px},${py}`);
    }
  }
});

test('brick size stays within 280–520px', () => {
  assert.equal(launcher.brickGeometry(400).w, 280);
  assert.equal(launcher.brickGeometry(4000).w, 520);
});

// Regression guards for the drag-stutter fixes: these are behavioural seams
// the headless browser cannot exercise (CDP input injection drops presses and
// the local worlds have no coverVideo assets), so pin the source shape.
test('tilt lean is skipped while a drag is in progress', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/components/WorldLauncher.tsx', import.meta.url), 'utf8');
  const leanCall = source.indexOf('tiltAllowed && !current?.moved');
  assert.ok(leanCall > -1, 'lean must be gated on the drag not having moved');
  const dragBranch = source.indexOf('if (current.moved)');
  assert.ok(dragBranch > -1 && dragBranch < leanCall, 'lean gate must sit after the pan branch');
});

test('brick videos never autoplay; playback is effect-driven and persistent', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/components/WorldLauncher.tsx', import.meta.url), 'utf8');
  assert.ok(!/\bautoPlay\b/.test(source.slice(source.indexOf('<video'), source.indexOf('</video>'))), 'video must not carry autoPlay (decoder restart cost on every window crossing)');
  assert.ok(source.includes('video.play()') && source.includes('video.pause()'), 'playback must be driven by the playing effect');
  assert.ok(source.includes('everPlayed'), 'video elements must persist once played (frozen frame instead of re-mount)');
  assert.ok(source.includes('return PLAYING_NONE'), 'dragging must freeze the playing set entirely');
});

test('restart target: a template or published world starts from its template; a draft from a fresh copy of the draft', () => {
  const shelf = {
    templates: ['wuwu'], worlds: [],
    groups: [
      group('wuwu', 'en'),
      group('made-11111111', 'zh-CN', { templatePath: 'published/made-11111111', workshop: { status: 'published', owner: 'local', mine: false, editPath: null } }),
      group('made-22222222', 'zh-CN', { templatePath: null, workshop: { status: 'draft', owner: 'local', mine: true, editPath: 'worlds/made-22222222' } }),
      group('made-33333333', 'zh-CN', { templatePath: null, workshop: { status: 'draft', owner: 'other', mine: false, editPath: null } }),
    ],
  };
  assert.deepEqual(launcher.restartTargetOf(shelf, 'wuwu'), { path: 'templates/wuwu', fresh: false });
  assert.deepEqual(launcher.restartTargetOf(shelf, 'made-11111111'), { path: 'published/made-11111111', fresh: false });
  assert.deepEqual(launcher.restartTargetOf(shelf, 'made-22222222'), { path: 'worlds/made-22222222', fresh: true });
  assert.equal(launcher.restartTargetOf(shelf, 'made-33333333'), null);
  assert.equal(launcher.restartTargetOf(shelf, ''), null);
  // A shelf not yet read still knows a shipped template by id.
  assert.deepEqual(launcher.restartTargetOf({ templates: ['wuwu'], worlds: [] }, 'wuwu'), { path: 'templates/wuwu', fresh: false });
});

test('trial origin: a play copy of my own made world leads back to its draft; the draft itself and others do not', () => {
  const shelf = {
    templates: ['wuwu'], worlds: [],
    groups: [
      group('wuwu', 'en'),
      group('made-22222222', 'zh-CN', { templatePath: null, workshop: { status: 'draft', owner: 'local', mine: true, editPath: 'worlds/made-22222222' } }),
      group('made-33333333', 'zh-CN', { templatePath: null, workshop: { status: 'draft', owner: 'other', mine: false, editPath: null } }),
    ],
  };
  const workshop = { status: 'draft', owner: 'local' };
  assert.equal(launcher.trialOriginOf(shelf, { id: 'made-22222222', authoring: false, workshop }), 'worlds/made-22222222');
  // In the draft itself there is nothing to go back to.
  assert.equal(launcher.trialOriginOf(shelf, { id: 'made-22222222', authoring: true, workshop }), null);
  assert.equal(launcher.trialOriginOf(shelf, { id: 'made-33333333', authoring: false, workshop }), null);
  assert.equal(launcher.trialOriginOf(shelf, { id: 'wuwu', authoring: false }), null);
  assert.equal(launcher.trialOriginOf(shelf, null), null);
});

// Fling coast.
test('release velocity: displacement over the last ~90ms, not the last event; zero after holding still', () => {
  // Steady 1 px/ms with one jittery event pair (2ms apart) at the end.
  const samples = [];
  for (let t = 0; t <= 96; t += 16) samples.push({ t, x: t, y: -t / 2 });
  samples.push({ t: 98, x: 104, y: -50 });
  const v = launcher.releaseVelocity(samples, 100, 80, 3);
  assert.ok(Math.abs(v.vx - 1) < 0.1, `vx ${v.vx}`);
  assert.ok(Math.abs(v.vy + 0.5) < 0.06, `vy ${v.vy}`);
  // The last event alone would have said 3 px/ms (6px in 2ms).
  assert.deepEqual(launcher.releaseVelocity(samples, 300, 80, 3), { vx: 0, vy: 0 }, 'held still before release: no coast');
  assert.deepEqual(launcher.releaseVelocity([], 0, 80, 3), { vx: 0, vy: 0 });
  assert.equal(launcher.releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 20, x: 400, y: 0 }], 20, 80, 3).vx, 3, 'capped');
});

test('glide step is time-based: one 32ms frame travels as far as two 16ms frames', () => {
  const one = launcher.glideStep(2, -1, 32);
  const a = launcher.glideStep(2, -1, 16);
  const b = launcher.glideStep(a.vx, a.vy, 16);
  assert.ok(Math.abs(one.dx - (a.dx + b.dx)) < 1e-9 && Math.abs(one.dy - (a.dy + b.dy)) < 1e-9);
  assert.ok(Math.abs(one.vx - b.vx) < 1e-12);
  assert.ok(Math.abs(launcher.glideStep(1, 0, 16).vx - launcher.GLIDE_DECAY_PER_16MS) < 1e-12);
  // A negative gap (rAF timestamp before the release) moves nothing; a stall is capped.
  assert.deepEqual(launcher.glideStep(1, 1, -5), { dx: 0, dy: 0, vx: 1, vy: 1 });
  assert.equal(launcher.glideStep(1, 0, 5000).dx, launcher.glideStep(1, 0, launcher.GLIDE_MAX_STEP_MS).dx);
});

test('the coast only moves the transform: rAF timestamps, the shared helpers, no React state per frame', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/components/WorldLauncher.tsx', import.meta.url), 'utf8');
  const up = source.slice(source.indexOf('const onPointerUp'), source.indexOf('const onHover'));
  assert.match(up, /releaseVelocity\(current\.samples/);
  const step = up.slice(up.indexOf('const step'), up.lastIndexOf('frames.current.glide = requestAnimationFrame(step);'));
  assert.match(step, /glideStep\(vx, vy, last < 0 \? 16 : now - last\)/);
  assert.ok(!/set[A-Z]\w*\(/.test(step), 'no React setState inside the coast frame');
  assert.ok(!/getBoundingClientRect|offset(Width|Height|Left|Top)|clientWidth/.test(step), 'no layout reads inside the coast frame');
  const css = await readFile(new URL('../src/components/world-launcher.css', import.meta.url), 'utf8');
  const sheen = /\.world-launcher__sheen \{[^}]*\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))[0];
  assert.ok(!/box-shadow/.test(sheen), 'the sheen is gradients, not blurred inset shadows (the coast\'s main GPU cost)');
});
