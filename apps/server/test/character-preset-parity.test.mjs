// B2/B3 — character-preset parity (04 §5.4). Pure file assertions, no engine:
// a repeated platform block rots silently unless a test pins it, and the same is
// true of a preset that names a slot nobody registered (doc-23 §4.4: a typo'd slot
// renders as empty text, so the agent quietly loses a whole personality section).
//
// The contract this defends (04 §5.3):
//   `presets/character.json` is the ONLY source template for character presets.
//   Any change to `hiddenOverrides.compaction` MUST land, in the same commit, on
//   every `templates/*/characters/*/preset.json` and `worlds/*/characters/*/preset.json`,
//   because `characterLaunch` prefers the world-side `characters/<id>/preset.json`
//   and only falls back to the repo preset (apps/server/src/engine/launch.ts:109-113).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// Slash-normalised so the allowlist keys below are identical on Windows and POSIX.
const rel = (abs) => path.relative(REPO_ROOT, abs).split(path.sep).join('/');
const readJson = (relPath) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8'));

const CHARACTER_TEMPLATE = 'presets/character.json';
const WRITER_TEMPLATE = 'presets/writer.json';

/** Every character preset a world can carry, relative to the repo root. */
function characterPresets() {
  const out = [];
  for (const tier of process.env.AIRP_CHECK_SAVES ? ['templates', 'worlds'] : ['templates']) {
    const tierDir = path.join(REPO_ROOT, tier);
    if (!fs.existsSync(tierDir)) continue;
    for (const world of fs.readdirSync(tierDir)) {
      if (!process.env.AIRP_CHECK_SAVES && world.includes('-playtest')) continue;
      // Experimental sandboxes (`exp: true`) carry a foreign character preset
      // verbatim; the platform-parity contract does not apply to them.
      try {
        if (JSON.parse(fs.readFileSync(path.join(tierDir, world, 'world.json'), 'utf-8')).exp === true) continue;
      } catch {
        // No/unreadable manifest: not experimental, let the walk see it.
      }
      const charsDir = path.join(tierDir, world, 'characters');
      if (!fs.existsSync(charsDir)) continue;
      for (const id of fs.readdirSync(charsDir)) {
        const file = path.join(charsDir, id, 'preset.json');
        if (fs.existsSync(file)) out.push(rel(file));
      }
    }
  }
  return out.sort();
}

// --------------------------------------------------------------------------- §5.4 (1-3)
// The exact text every character preset must agree on, field by field.

test('04 §5.4: every character preset carries the template compaction verbatim', () => {
  const baseline = readJson(CHARACTER_TEMPLATE).hiddenOverrides?.compaction;
  assert.ok(baseline, `${CHARACTER_TEMPLATE} must define hiddenOverrides.compaction`);
  assert.deepEqual(
    Object.keys(baseline).sort(),
    ['branchSummaryPrompt', 'initialPrompt', 'systemPrompt', 'turnPrefixPrompt', 'updatePrompt'],
    'compaction has exactly the five engine-read fields (04 §2.4)',
  );

  // Floor, not an exact count: 04 §5.1 listed 7 at design time, the repo has grown
  // since, and a new world must not be forced to update this test. The floor still
  // guards against a broken walk passing vacuously.
  const files = characterPresets();
  assert.ok(files.length >= 7, `expected the template/world character presets, found ${files.length}`);
  assert.ok(files.includes('templates/wuwu/characters/old-mo/preset.json'), 'walk must reach templates/');
  // Player saves are ignored by Git; audit them explicitly with AIRP_CHECK_SAVES=1.

  for (const presetPath of files) {
    const compaction = readJson(presetPath).hiddenOverrides?.compaction;
    assert.ok(compaction, `${presetPath} must carry hiddenOverrides.compaction (it shadows ${CHARACTER_TEMPLATE})`);
    assert.deepEqual(compaction, baseline, `${presetPath} compaction must equal ${CHARACTER_TEMPLATE} verbatim`);
  }
});

test('04 §5.4 + §2.4: compaction prompts use only placeholders their call site replaces', () => {
  for (const template of [WRITER_TEMPLATE, CHARACTER_TEMPLATE]) {
    const { compaction } = readJson(template).hiddenOverrides;
    assert.deepEqual(
      Object.keys(compaction).sort(),
      ['branchSummaryPrompt', 'initialPrompt', 'systemPrompt', 'turnPrefixPrompt', 'updatePrompt'],
      `${template} must carry all five engine-read compaction fields`,
    );
    // `{previous_summary}` is substituted ONLY in initialPrompt / updatePrompt
    // (compaction.ts:678-683); a literal one left in the other two confuses the model.
    for (const field of ['turnPrefixPrompt', 'branchSummaryPrompt']) {
      assert.ok(!compaction[field].includes('{previous_summary}'), `${template} ${field} must not use {previous_summary}`);
    }
    for (const field of ['initialPrompt', 'updatePrompt', 'turnPrefixPrompt', 'branchSummaryPrompt']) {
      assert.ok(compaction[field].includes('{conversation}'), `${template} ${field} must interpolate {conversation}`);
    }
  }
});

test('04 §5.4 (allowlist): a character preset without the platform slots is registered, not silent', () => {
  // 00 §3.3 / doc-23 §3.1: the platform stance lives in `extensions/instructions.ts`
  // slots. A preset that omits them does not fail — it just renders without them.
  // Keeping such presets in a literal allowlist makes "not migrated" a visible state
  // instead of a silent hole. `worlds/test-school/characters/七海/preset.json` is the
  // one legacy holdout (its `id` is `nanami`, and its platform text is an inline Chinese
  // block instead of the `system-char` slot; 04 §5.4).
  const KNOWN_SLOTLESS = new Set(['worlds/test-school/characters/七海/preset.json']);

  for (const presetPath of characterPresets()) {
    const preset = readJson(presetPath);
    const slots = preset.items.filter((i) => i.kind === 'slot').map((i) => i.slot);
    if (slots.includes('system-char')) continue;
    assert.ok(
      KNOWN_SLOTLESS.has(presetPath),
      `${presetPath} lacks the "system-char" slot and is not in KNOWN_SLOTLESS — either add the slot or register the exemption`,
    );
  }
});

// --------------------------------------------------------------------------- §5.4 (4)

/** Slot names `extensions/instructions.ts` registers, read from source (a typo here is the bug under test). */
function registeredAirpSlots() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'extensions', 'instructions.ts'), 'utf-8');
  return new Set([...src.matchAll(/registerSlot\(\{[\s\S]*?name:\s*"([^"]+)"/g)].map((m) => m[1]));
}

// Engine built-ins (vendor/pi-rp/.../slot-renderers.ts:50 `SUPPORTED_SLOTS`). Hardcoded
// because vendor/ is not tracked; if the engine gains a slot this list must follow.
const ENGINE_BUILTIN_SLOTS = new Set([
  'chat-history', 'tools', 'tool-guidelines', 'skills', 'project-context', 'append-system-prompt',
  'date', 'cwd', 'date-cwd', 'active-model', 'pi-docs', 'variables', 'state', 'file',
  'awaken', 'recent', 'index',
]);

test('04 §5.4 (4): every slot named by the two base presets is actually registered', () => {
  const known = new Set([...registeredAirpSlots(), ...ENGINE_BUILTIN_SLOTS]);
  assert.ok(registeredAirpSlots().size >= 6, 'instructions.ts slot registration must be discoverable');

  for (const presetPath of [WRITER_TEMPLATE, CHARACTER_TEMPLATE]) {
    for (const item of readJson(presetPath).items) {
      if (item.kind !== 'slot') continue;
      assert.ok(known.has(item.slot), `${presetPath} item "${item.id}" names unregistered slot "${item.slot}"`);
    }
  }
});

test('04 §5.4 (4): the writer and character templates ship their stance slots', () => {
  const writerSlots = readJson(WRITER_TEMPLATE).items.filter((i) => i.kind === 'slot').map((i) => i.slot);
  const characterSlots = readJson(CHARACTER_TEMPLATE).items.filter((i) => i.kind === 'slot').map((i) => i.slot);
  assert.ok(writerSlots.includes('writer-char'), 'writer preset must render WRITER_INSTRUCTION');
  assert.ok(characterSlots.includes('system-char'), 'character preset must render CHARACTER_INSTRUCTION');
});
