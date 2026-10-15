// Canvas presence layer.
// Source text + pure-function assertions — no DOM needed, same style as
// layout-depth-seam.test.mjs. Run: node --test apps/web/test/presence-layer.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const src = await readFile(new URL('../src/components/canvas/PresenceLayer.tsx', import.meta.url), 'utf8');
const canvas = await readFile(new URL('../src/components/canvas/Canvas.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/components/canvas/presence-layer.css', import.meta.url), 'utf8');
// Comments mention `.object` / `data-path` on purpose (they explain WHY the node is
// not a card), so every source-text assertion inspects the code with comments stripped.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let node = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: true, tryNative: false });
  node = await jiti.import('../src/lib/presence-node.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping presence-node group:', err?.message ?? err);
}
const skip = node ? false : 'jiti or pi-rp submodule unavailable';

test('presence nodes are placed at the CENTRE (presence.x/y), not a top-left', { skip }, () => {
  assert.equal(
    node.presenceRootTransform({ id: 'watson', state: 'in-scene', position: { x: 1056, y: 540 } }),
    'translate3d(1056px, 540px, 0)'
  );
  // Dirty coordinates must not emit NaN; the node stays renderable at the origin.
  assert.equal(
    node.presenceRootTransform({ id: 'x', state: 'in-scene', position: { x: NaN, y: 1 } }),
    'translate3d(0px, 0px, 0)'
  );
  assert.equal(
    node.presenceRootTransform({ id: 'x', state: 'in-scene', position: null }),
    'translate3d(0px, 0px, 0)'
  );
  // The inner anchor is what turns the point into a centred box.
  // The inner anchor (in CSS) is what turns the point into a centred box.
  assert.match(css, /translate\(-50%,\s*-50%\)/);
});

test('only in-scene characters render; absent/elsewhere are not drawn', () => {
  assert.match(src, /state === 'in-scene'/);
  assert.match(src, /view\.position !== null|position !== null/);
  assert.doesNotMatch(code, /state\.presence/); // never bypasses the projection
  assert.doesNotMatch(code, /\bitems\b/); // presence never enters `items`
});

test('presence nodes never become cards (P-19: assert the class, not the word "object")', { skip }, () => {
  // The old `\bobject\b` assertion flagged correct code (Object.keys, typeof === 'object').
  assert.equal(node.PRESENCE_NODE_CLASS, 'presence-avatar'); // not `.presence-orb` (02 §11 C-2)
  assert.doesNotMatch(node.PRESENCE_NODE_CLASS, /object/);
  assert.doesNotMatch(node.PRESENCE_NODE_ATTR, /object/);
  // The rendered className must never be an object-shaped literal.
  assert.doesNotMatch(code, /className=["'][^"']*\bobject\b/);
  assert.doesNotMatch(code, /data-path/);
  assert.match(src, /PRESENCE_NODE_ATTR/);
  assert.match(src, /PRESENCE_NODE_CLASS/);
});

test('Canvas mounts PresenceLayer inside the world transform layer and guards the pointer seams', () => {
  assert.match(canvas, /<PresenceLayer\b/);
  assert.match(canvas, /presence\?: CharacterPresenceView\[\]/);
  assert.match(canvas, /closest\(`\[\$\{PRESENCE_NODE_ATTR\}\]`\)/);
  // Both seams guard: card-drag/pan dispatch AND the radial context menu.
  assert.equal((canvas.match(/closest\(`\[\$\{PRESENCE_NODE_ATTR\}\]`\)/g) ?? []).length, 2);
  // Mounted inside the world transform layer: after the cards, before the particles.
  const world = canvas.slice(canvas.indexOf('<div ref={camera.worldRef}'), canvas.indexOf('<ParticleLayer'));
  assert.ok(world.includes('<PresenceLayer'));
  assert.ok(world.indexOf('<PresenceLayer') > world.indexOf('{items.map'));
});

test('damping thresholds match contract §4.2 verbatim', { skip }, () => {
  assert.equal(node.PRESENCE_SLIDE_MS, 480);
  assert.equal(node.PRESENCE_SLIDE_EASE, 'cubic-bezier(.22,.61,.36,1)');
  assert.equal(node.PRESENCE_EXIT_MS, 260);
  assert.equal(node.PRESENCE_EXIT_EASE, 'ease-out');
  assert.equal(node.PRESENCE_ENTER_MS, 360);
  assert.equal(node.PRESENCE_ENTER_OFFSET_PX, 8);
  assert.equal(node.PRESENCE_STAGGER_MS, 60);
  assert.equal(node.PRESENCE_STILL_MS, 120);
});

test('displacement is NOT gated by the Effects toggle (contract §4.2 ruling)', { skip }, () => {
  // Non-emptiness: implementing the old reading (effectsEnabled as an input) fails here.
  assert.equal(node.presenceMotionAllowed({ reducedMotion: false, pageVisible: true }), true);
  assert.doesNotMatch(src, /effectsEnabled/);
  assert.match(src, /data-still/);
  assert.doesNotMatch(canvas, /<PresenceLayer[^>]*effectsEnabled/);
  assert.doesNotMatch(src, /localStorage/);
});

test('reduced motion / hidden page: no displacement, opacity only, <=120ms', { skip }, () => {
  assert.equal(node.presenceMotionAllowed({ reducedMotion: false, pageVisible: true }), true);
  for (const prefs of [
    { reducedMotion: true, pageVisible: true },
    { reducedMotion: false, pageVisible: false },
    { reducedMotion: true, pageVisible: false },
  ]) {
    assert.equal(node.presenceMotionAllowed(prefs), false);
    const d = node.presenceEntryDescriptor(0, { id: 'w', state: 'in-scene', arrivedByFollow: false }, prefs);
    assert.equal(d.offsetPx, 0);
    assert.equal(d.delayMs, 0);
    assert.ok(d.durationMs <= node.PRESENCE_STILL_MS);
  }
});

test('followed-in characters are treated as an entry and staggered last (P-17: three self-consistent claims)', { skip }, () => {
  const on = { reducedMotion: false, pageVisible: true };
  const views = [
    { id: 'a', state: 'in-scene', arrivedByFollow: true },
    { id: 'b', state: 'in-scene', arrivedByFollow: false },
    { id: 'c', state: 'in-scene', arrivedByFollow: true },
    { id: 'd', state: 'in-scene', arrivedByFollow: false },
  ];
  // 1. Grouping: non-followers (array order) then followers (array order).
  assert.deepEqual(node.presenceRenderOrder(views).map((v) => v.id), ['b', 'd', 'a', 'c']);
  const ordered = node.presenceRenderOrder(views);
  const lastPlain = ordered.findLastIndex((v) => !v.arrivedByFollow);
  const firstFollower = ordered.findIndex((v) => v.arrivedByFollow);
  // 2. Ordering: every follower lands after every non-follower.
  assert.ok(firstFollower > lastPlain, 'every follower must come after every non-follower');
  // 3. Delay follows order: `order × stagger`, so followers always wait longer.
  const follower = node.presenceEntryDescriptor(firstFollower, ordered[firstFollower], on);
  const plain = node.presenceEntryDescriptor(lastPlain, ordered[lastPlain], on);
  assert.ok(follower.delayMs > plain.delayMs, 'followed-in nodes must sort last');
  assert.equal(follower.offsetPx, node.PRESENCE_ENTER_OFFSET_PX); // an entry, never a cross-layer slide
  assert.equal(node.presenceEntryDescriptor(3, ordered[3], on).delayMs, 3 * node.PRESENCE_STAGGER_MS);
  // The component must consume the ordering function, not the raw array order.
  assert.match(src, /presenceRenderOrder\(/);
});

test('CSS: semantic depth only, transform/opacity only, reduced-motion override present', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const value of [...rules.matchAll(/z-index\s*:\s*([^;}\n]+)/g)].map((m) => m[1])) {
    assert.match(value, /^var\(--depth-[a-z0-9-]+\)\s*(?:!important)?$/);
  }
  assert.doesNotMatch(rules, /transition[^;}]*\b(left|top)\b/);
  assert.match(rules, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(rules, /\.presence-avatar--exiting[^\{]*\{[^}]*pointer-events\s*:\s*none/);
  assert.doesNotMatch(src, /requestAnimationFrame/); // no resident rAF
});

test('exiting snapshot is non-interactive and outside world state', () => {
  assert.match(src, /aria-hidden/); // the phantom is not announced
  assert.match(src, /exiting/);
  // No world-state write-back: the component touches neither the world store nor the
  // gateway — its only state is the local exit list plus the avatar's load status.
  assert.doesNotMatch(code, /useWorld|airpGateway|dispatchEvent|localStorage/);
  const reactSetters = [...code.matchAll(/(?<!window\.)\bset[A-Z]\w*\(/g)].map((m) => m[0]);
  assert.ok(reactSetters.every((call) => call.startsWith('setExiting(') || call.startsWith('setFailedSrc(') || call.startsWith('setVisible(')));
});
