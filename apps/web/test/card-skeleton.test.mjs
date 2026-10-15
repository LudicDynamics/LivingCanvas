// Skeleton-shape pure-function assertions. `lib/card-skeleton.ts`
// has no DOM and no React, so jiti imports the TS source directly — same bootstrap
// as ghost.test.mjs. Run: node --test apps/web/test/card-skeleton.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

let mod = null;
try {
  const { createJiti } = await import('../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs');
  const jiti = createJiti(import.meta.url, { moduleCache: false, tryNative: true });
  mod = await jiti.import('../src/lib/card-skeleton.ts');
} catch (err) {
  console.error('jiti/bootstrap unavailable, skipping card-skeleton group:', err?.message ?? err);
}

const skip = mod ? false : 'jiti or pi-rp submodule unavailable';
const { skeletonShapeFor, cardWritingGuard } = mod ?? {};

// `CARD_FORMS` resolves from the web workspace via the SUBPATH (never the
// barrel — the barrel pulls in `node:crypto`, breaking the browser build).
let cardForms = null;
try {
  ({ CARD_FORMS: cardForms } = await import('@airp/shared/forms'));
} catch (err) {
  console.error('CARD_FORMS unavailable, skipping the html form group:', err?.message ?? err);
}
const skipForm = mod && cardForms ? false : 'jiti/pi-rp or @airp/shared/forms unavailable';

test('every chrome tier returns a stable, non-empty shape', { skip }, () => {
  // One representative kind per tier (mirrors the design's per-tier table).
  const byTier = {
    paper: 'letter',
    note: 'note',
    slab: 'lock',
    board: 'board',
    panel: 'clock',
    scroll: 'map',
    cover: 'gate',
    bare: 'chalk',
  };
  for (const [tier, kind] of Object.entries(byTier)) {
    const shape = skeletonShapeFor(kind);
    assert.equal(shape.chrome, tier, `${kind} → tier ${tier}`);
    // Non-emptiness: every non-bare tier either draws lines or a decor element.
    if (tier !== 'bare') {
      assert.equal(shape.visible, true, `${tier} must be visible`);
      const hasLines = shape.lines.length > 0;
      const hasDecor = Object.values(shape.decor).some(Boolean);
      assert.ok(hasLines || hasDecor, `${tier} must not be an empty box`);
    } else {
      assert.equal(shape.visible, false, 'bare must draw nothing');
      assert.equal(shape.lines.length, 0);
    }
  }
});

test('bare tier covers chalk / sprite / portrait (never drawn)', { skip }, () => {
  for (const kind of ['chalk', 'sprite', 'portrait']) {
    assert.equal(skeletonShapeFor(kind).visible, false, `${kind} must not draw`);
  }
});

test('unknown kind falls back to paper, not a blank shape', { skip }, () => {
  // Non-emptiness guard: a bogus kind must still yield the paper tier.
  const shape = skeletonShapeFor('not-a-real-kind');
  assert.equal(shape.chrome, 'paper');
  assert.equal(shape.visible, true);
  assert.ok(shape.lines.length >= 3, 'fallback must draw lines');
  // `undefined` (defensive) behaves identically.
  assert.equal(skeletonShapeFor(undefined).chrome, 'paper');
});

test('line count is clamped by tier, driven by the form height', { skip }, () => {
  // book h=264: raw floor((264-44)/34)=6 → clamped to paper's max 4.
  assert.equal(skeletonShapeFor('book').lines.length, 4);
  // letter h=176: floor((176-44)/34)=3 → within [3,4].
  assert.equal(skeletonShapeFor('letter').lines.length, 3);
  // slab has zero lines (its shape is the block decor).
  assert.equal(skeletonShapeFor('lock').lines.length, 0);
  assert.equal(skeletonShapeFor('lock').decor.block, true);
});

test('panel draws equal-width bars', { skip }, () => {
  const shape = skeletonShapeFor('clock');
  assert.equal(shape.chrome, 'panel');
  assert.ok(shape.lines.length > 0);
  assert.ok(shape.lines.every((l) => l.w === 80), 'panel lines are equal width');
});

test('shape is a fresh object each call (no shared frozen reference)', { skip }, () => {
  const a = skeletonShapeFor('note');
  const b = skeletonShapeFor('note');
  assert.notEqual(a, b);
  assert.notEqual(a.lines, b.lines);
  assert.notEqual(a.decor, b.decor);
  a.lines.push({ w: 1, h: 1 });
  a.decor.ruled = false;
  assert.equal(b.lines.length, 3, 'mutating one shape must not affect the next');
  assert.equal(b.decor.ruled, true);
});

test('cardWritingGuard is a whitelist (bare / gate / missing layer all rejected)', { skip }, () => {
  const note = { chrome: 'note' };
  const bare = { chrome: 'bare' };
  const cover = { chrome: 'cover' };
  // Happy path: known non-bare, non-gate, resolved layer.
  assert.equal(cardWritingGuard(note, 'note', 'world/baker-street'), true);
  // `!form` → no size source.
  assert.equal(cardWritingGuard(undefined, 'note', 'world/map'), false);
  // bare tier → would steal a seat while drawing nothing.
  assert.equal(cardWritingGuard(bare, 'chalk', 'world/map'), false);
  // gate (README) → never enters `items`, would leak forever.
  assert.equal(cardWritingGuard(cover, 'gate', 'world/map'), false);
  // Non-emptiness: blacklist that forgets `!layer` would wrongly accept this.
  assert.equal(cardWritingGuard(note, 'note', undefined), false);
  assert.equal(cardWritingGuard(note, 'note', ''), false);
});

// ── the design notes (M10): html rides the panel tier with NO html code ──
//
// The design marked this `[推断]`; this case turns it into a mechanical claim.
// It is ALSO the mechanical check for M1 having landed BOTH halves: the registry
// `.html` branch AND the `CARD_FORMS.html` row. The load-time validation in
// `registry.ts` only walks `ALL` (registered components) — and `html` is NOT
// registered — so a missing form row throws NOTHING and silently draws no
// skeleton at all.
test('html rides the panel tier unchanged (no html-specific skeleton code)', { skip: skipForm }, () => {
  const shape = skeletonShapeFor('html');
  assert.equal(shape.chrome, 'panel');
  assert.equal(shape.visible, true);
  // h = 203 → clamp(floor((203 - 44) / 34), 2, 5) = 4 (card-skeleton.ts:71,73,78-87)
  assert.equal(shape.lines.length, 4);
  // `panel` is the equal-width branch (card-skeleton.ts:120) — no ragged pattern.
  assert.deepEqual(shape.lines.map((l) => l.w), [80, 80, 80, 80]);
  // A pale ink wash: "a web page is a slab of screen" (contract §4.3).
  assert.equal(shape.decor.wash, true);
  // Registering side: layer resolved + non-bare chrome ⇒ the skeleton is legal.
  assert.ok(cardForms.html, 'CARD_FORMS.html must exist (NOTHING throws if it is missing — §3.1.1)');
  assert.equal(cardForms.html.w, 360);
  assert.equal(cardForms.html.h, 203);
  assert.equal(cardWritingGuard(cardForms.html, 'html', 'world/a'), true);
  assert.equal(cardWritingGuard(cardForms.html, 'html', undefined), false);
  // The "half-done M1" state: the registry branch without the form row. This is
  // what actually silences the skeleton, and NOTHING in the repo throws for it
  // (§3.1.1: the load-time check only walks `ALL`, and `html` is not registered).
  // `useWorld.ts:910` does the DIRECT lookup `CARD_FORMS[kind]` — never
  // `?? CARD_FORMS.default` (that fallback lives in `skeletonShapeFor`, which
  // the guard rejects before it is ever reached). So the value the guard sees
  // is `undefined`, NOT `CARD_FORMS.default` — and `CARD_FORMS.default` would
  // have PASSED (chrome 'paper' ≠ 'bare'), which is exactly why asserting on
  // the wrong argument would be a test that cannot catch the real bug.
  assert.equal(cardWritingGuard(undefined, 'html', 'world/a'), false,
    'a missing CARD_FORMS.html row reaches the guard as `undefined` and draws nothing');
  assert.equal(cardWritingGuard(cardForms.default, 'html', 'world/a'), true,
    'guard control: the `?? default` fallback WOULD have seated a paper card');
});
