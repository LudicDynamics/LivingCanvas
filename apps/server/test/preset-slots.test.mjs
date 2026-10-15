// B2/B3 — preset slot assembly. Pure file
// assertions, no engine:
//   `00 §4.2` froze the item list of every preset. A slot is rendered as TEXT —
//   a missing one is not an error, the agent just quietly loses a whole section
//   (tools list / guidelines / skills). The same is true of `tools.deny`: without
//   it the `tools` slot prints pi-rp's Chinese memory/state tools into an English
//   prompt (F5/F6, measured). Both are asserted here, plus the world-side parity
// `the design notes` warns about: a character's own preset.json shadows the repo
//   fallback, so BOTH must carry the same platform items.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { templateShipped } from '../../../tools/shipped-worlds.mjs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rel = (abs) => path.relative(REPO_ROOT, abs).split(path.sep).join('/');
const readJson = (relPath) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8'));

const WRITER = 'presets/writer.json';
const CHARACTER = 'presets/character.json';
const INIT_PRESETS = ['presets/scene-init.json', 'presets/nook-init.json'];

/** The 14 pi-rp inline-extension / state tool names every AIRP preset must deny (F6). */
const DENIED = [
  'recall', 'retrieve', 'memorize', 'revise', 'forget', 'relocate', 'associate',
  'trigger', 'consolidate', 'retrace', 'set_time', 'awaken', 'get_state', 'state_update',
];

/**
 * The repository's own presets deny `bash` as well (security audit 2026-09-25):
 * the model should not even see a shell. World-side character presets keep the
 * 14 — they shadow these and a copy lives in every save, so the shell is refused
 * in code for them instead (extensions/toolkit/read-fence.ts).
 */
const REPO_DENIED = ['bash', ...DENIED];

/** The three slots the phase-05 assembly adds to writer + character presets. */
const PLATFORM_SLOTS = ['tools', 'tool-guidelines', 'skills'];

const slotsOf = (presetPath) =>
  readJson(presetPath).items.filter((i) => i.kind === 'slot').map((i) => i.slot);
const itemOf = (presetPath, slot) =>
  readJson(presetPath).items.find((i) => i.kind === 'slot' && i.slot === slot);

/** Every character preset a world can carry (`templates/` + `worlds/`). */
function characterPresets() {
  const out = [];
  for (const tier of process.env.AIRP_CHECK_SAVES ? ['templates', 'worlds'] : ['templates']) {
    const tierDir = path.join(REPO_ROOT, tier);
    if (!fs.existsSync(tierDir)) continue;
    for (const world of fs.readdirSync(tierDir)) {
      if (!process.env.AIRP_CHECK_SAVES && world.includes('-playtest')) continue;
      // An experimental sandbox (`world.json` `exp: true`) ships a character
      // preset verbatim from another project on purpose: it is not AIRP
      // platform content and must not be forced into the platform item list.
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

// The one legacy holdout: `worlds/test-school/characters/七海/preset.json` carries an
// inline Chinese platform block instead of the `system-char` slot. Listing it keeps
// "not migrated" a VISIBLE state rather than a silent hole.
const KNOWN_SLOTLESS = new Set(['worlds/test-school/characters/七海/preset.json']);

// --------------------------------------------------------------------------- (1)

test('00 §4.2: the writer preset carries the platform slots in the frozen order', () => {
  const preset = readJson(WRITER);
  assert.deepEqual(
    slotsOf(WRITER),
    ['writer-char', 'tools', 'tool-guidelines', 'skills', 'chat-history'],
    `${WRITER} items must match 00 §4.2 verbatim — a reorder splits the cached system prompt`,
  );
  // `onlyWithSnippets: true` is exactly what makes a missing promptSnippet a SILENT
  // drop (slot-renderers.js:91), so it is part of the contract, not a default.
  assert.equal(itemOf(WRITER, 'tools').options?.onlyWithSnippets, true, 'tools slot needs onlyWithSnippets: true');
  assert.equal(
    itemOf(WRITER, 'tool-guidelines').options?.includePiDefaultGuidelines,
    false,
    'tool-guidelines must drop the Pi coding-assistant guidelines (F9: needs the vendored dist fix)',
  );
  assert.deepEqual(preset.tools?.deny, REPO_DENIED, `${WRITER} must deny bash and exactly the 14 measured tool names (F6)`);
});

// --------------------------------------------------------------------------- (2)

test('00 §4.2: the repo character fallback carries the platform slots and no file profile', () => {
  const preset = readJson(CHARACTER);
  assert.deepEqual(
    slotsOf(CHARACTER),
    ['system-char', 'tools', 'tool-guidelines', 'skills', 'chat-history'],
    `${CHARACTER} items must match 00 §4.2 verbatim`,
  );
  // The fallback has NO `file`/profile slot on purpose: its baseDir would have to name
  // one character, yet the fallback serves every character with no preset.json.
  assert.ok(
    !slotsOf(CHARACTER).includes('file'),
    `${CHARACTER} must not pin a file profile — baseDir is per-character (05 §3.2)`,
  );
  assert.deepEqual(preset.tools?.deny, REPO_DENIED, `${CHARACTER} must deny bash and exactly the 14 measured tool names`);
});

// --------------------------------------------------------------------------- (3)

test('00 §4.2: the init presets keep skills and deliberately omit tools (subagent tool face)', () => {
  for (const presetPath of INIT_PRESETS) {
    const slots = slotsOf(presetPath);
    assert.ok(slots.includes('skills'), `${presetPath} must keep the skills slot (init reads the world voice)`);
    for (const slot of PLATFORM_SLOTS.filter((s) => s !== 'skills')) {
      assert.ok(!slots.includes(slot), `${presetPath} must NOT name "${slot}" — the subagent tool face is not preset-driven (00 §4.2)`);
    }
    assert.ok(!slots.includes('chat-history'), `${presetPath} has inheritHistory: 0 — it must not pull history`);
    assert.ok(readJson(presetPath).delegatable === true, `${presetPath} must stay delegatable`);
  }
});

// --------------------------------------------------------------------------- (4)

test('05 §3.3: every character preset carries the platform slots verbatim (world-side shadows the repo)', () => {
  const files = characterPresets();
  // Floor, not an exact count: a new world must not have to edit this test, but a
  // broken walk (0 files) would pass vacuously.
  assert.ok(files.length >= 9, `expected the template/world character presets, found ${files.length}`);
  for (const anchor of [
    'templates/wuwu/characters/old-mo/preset.json',
    // First Snow is not in the open-source copy; its preset is an anchor where it is.
    ...(templateShipped('first-snow') ? ['templates/first-snow/characters/sumi-yukimura/preset.json'] : []),
    'templates/whitechapel/characters/watson/preset.json',
  ]) {
    assert.ok(files.includes(anchor), `walk must reach ${anchor}`);
  }

  let checked = 0;
  for (const presetPath of files) {
    if (KNOWN_SLOTLESS.has(presetPath)) continue;
    checked++;
    const preset = readJson(presetPath);
    const slots = slotsOf(presetPath);
    // The platform items must be IDENTICAL in name and options to the repo fallback —
    // a world-side preset with a different order/options is the the design notes trap.
    assert.deepEqual(
      preset.items.filter((i) => i.kind === 'slot' && PLATFORM_SLOTS.includes(i.slot)),
      readJson(CHARACTER).items.filter((i) => i.kind === 'slot' && PLATFORM_SLOTS.includes(i.slot)),
      `${presetPath} platform items must equal ${CHARACTER} verbatim (world-side preset shadows the fallback)`,
    );
    assert.deepEqual(preset.tools?.deny, DENIED, `${presetPath} must deny the 14 tool names`);
    assert.ok(slots.includes('system-char'), `${presetPath} must render CHARACTER_INSTRUCTION`);
    assert.ok(slots.includes('file'), `${presetPath} must carry its own profile file slot (baseDir is per-character)`);
  }
  assert.ok(checked >= 9, `expected >= 9 migrated character presets, checked ${checked}`);
});

// --------------------------------------------------------------------------- (5)

/** Slot names `extensions/instructions.ts` registers, read from source. */
function registeredAirpSlots() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'extensions', 'instructions.ts'), 'utf-8');
  return new Set([...src.matchAll(/registerSlot\(\{[\s\S]*?name:\s*"([^"]+)"/g)].map((m) => m[1]));
}

// Engine built-ins (vendor/pi-rp/.../prompt-preset/slot-renderers.js:33-51 `SUPPORTED_SLOTS`).
// Hardcoded because vendor/ is not tracked; if the engine gains a slot this list follows.
const ENGINE_BUILTIN_SLOTS = new Set([
  'chat-history', 'tools', 'tool-guidelines', 'skills', 'project-context', 'append-system-prompt',
  'date', 'cwd', 'date-cwd', 'active-model', 'pi-docs', 'variables', 'state', 'file',
  'awaken', 'recent', 'index',
]);

test('05 §9.2: every slot named by any of the four presets is actually registered', () => {
  const known = new Set([...registeredAirpSlots(), ...ENGINE_BUILTIN_SLOTS]);
  assert.ok(registeredAirpSlots().size >= 6, 'instructions.ts slot registration must be discoverable');

  for (const presetPath of [WRITER, CHARACTER, ...INIT_PRESETS]) {
    for (const item of readJson(presetPath).items) {
      if (item.kind !== 'slot') continue;
      assert.ok(known.has(item.slot), `${presetPath} item "${item.id}" names unregistered slot "${item.slot}"`);
    }
  }
});
