#!/usr/bin/env node
/**
 * Voice-corpus gate (`pnpm check:voices`) — the design notes, the design notes
 *
 * The bugs this exists to catch, all three of which shipped once (07 §0):
 *   1. `voice: Eldric` — a raw id that is NOT a DashScope voice (the real one
 *      is `Eldric Sage`), so the character was silent on every page.
 *   2. `voice: Sage` — the other half of the same mistake.
 *   3. `voice: Eldric Sage` reaching `POST /api/tts` and being silently
 *      rewritten to the default, because the old shape regex forbade spaces.
 *
 * The palette (`resolveVoice`) is the single vocabulary; this walks every
 * character README in every template and asserts its declaration RESOLVES.
 * A file that declares nothing is fine — it means "use the server default".
 *
 * V6/V7: per world language, every alias — and every
 * edition's every character — is cast on a voice that speaks the world's
 * language and keeps the declared gender.
 *
 * V5 keeps the `voice-casting` skill's palette reference in step with the
 * palette. That file is a GENERATED artifact (08 §4.1): this script is its only
 * renderer, so the reference cannot drift into recommending a voice that no
 * longer exists. `--write-ref` regenerates it.
 *
 * This is a CONTENT gate, not a runtime one: it never touches the network.
 * Whether a palette id actually synthesises is established by 07 §5's recorded
 * run, not re-litigated here (a gate that needs an API key is a gate that gets
 * skipped).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VOICES,
  VOICE_COUNT,
  WORLD_LANGUAGES,
  castVoice,
  VOICE_ROSTER,
  inferVoiceProfile,
  resolveVoice,
  resolveVoiceFor,
  voiceEntry,
  voiceSpeaks,
  worldLanguageOf,
} from '../packages/shared/dist/index.js';
import { isExperimentalWorld } from './world-editions.mjs';
import { validateRoster } from './sync-voice-roster.mjs';

import { parseFrontmatter } from '../vendor/pi-rp/packages/coding-agent/dist/utils/frontmatter.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (abs) => path.relative(REPO, abs).split(path.sep).join('/');

let failed = 0;
const check = (label, ok, extra = '') => {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    console.error(`FAIL  ${label}${extra ? ` — ${extra}` : ''}`);
    failed++;
  }
};
const WRITE_REF = process.argv.includes('--write-ref');

/**
 * Render `references/voice-palette.md` for the `voice-casting` skill (08 §4.2):
 * alias + tone ONLY — the engine's ids stay out of it, so nobody copies one.
 * Grouped by gender because that is the axis a caster checks first.
 */
function renderPaletteRef() {
  const byGender = (g) => VOICES.filter((v) => v.gender === g);
  const rows = (g) =>
    byGender(g)
      .map((v) => `| \`${v.alias}\` | ${v.tone} |`)
      .join('\n');
  return `# The voice palette

Every voice you may write in a character's \`voice:\` line. Pick by the sound, not by the name: the
left column is what you type, the right column is what it sounds like.

This file is GENERATED from \`packages/shared/src/rules/voices.ts\` — do not edit it by hand. To add
a voice, follow \`docs/tts/07\` (it must be observed to synthesise) and run
\`node tools/check-voices.mjs --write-ref\`.

## Female

| Alias | Sounds like |
|---|---|
${rows('female')}

## Male

| Alias | Sounds like |
|---|---|
${rows('male')}

Rule: two characters in the SAME world must not share a voice. Cross-world reuse is fine.
`;
}

const REF_PATH = path.join(REPO, 'skills', 'voice-casting', 'references', 'voice-palette.md');

if (WRITE_REF) {
  fs.mkdirSync(path.dirname(REF_PATH), { recursive: true });
  fs.writeFileSync(REF_PATH, renderPaletteRef());
  console.log(`wrote ${rel(REF_PATH)}`);
  process.exit(0);
}

// --------------------------------------------------------------------- V0

// A vacuous pass would hide everything below: an empty palette resolves nothing,
// and an empty README walk checks nothing.
check('palette is non-empty', VOICE_COUNT > 0, `${VOICE_COUNT} entries`);
assert.ok(VOICES.length > 0, 'palette is empty — the import is wrong, not the corpus');

const missingDist = !fs.existsSync(path.join(REPO, 'packages/shared/dist/rules/voices.js'));
if (missingDist) {
  console.error(
    '\npackages/shared/dist/rules/voices.js is missing — run `pnpm --filter @airp/shared build` first (AGENTS.md §6.5).'
  );
  process.exit(1);
}

// --------------------------------------------------------------------- V1

// Alias and id are BOTH vocabularies; each must resolve, and no two aliases may
// collide (a duplicate alias would make resolution order-dependent).
const seenAlias = new Set();
const seenId = new Set();
for (const v of VOICES) {
  check(`palette alias is kebab-case: ${v.alias}`, /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.alias));
  check(`palette alias is unique: ${v.alias}`, !seenAlias.has(v.alias));
  seenAlias.add(v.alias);
  check(`palette id is unique: ${v.id}`, !seenId.has(v.id));
  seenId.add(v.id);
  check(
    `palette entry resolves to itself: ${v.alias} → ${v.id}`,
    resolveVoice(v.alias) === v.id && resolveVoice(v.id) === v.id
  );
}

// --------------------------------------------------------------------- V2

// The shape the old regex broke: a real voice id may contain a space. If the
// palette ever loses this property the gate's own premise is gone, so assert a
// spaced id survives, then assert the whole palette does.
const spaced = VOICES.filter((v) => v.id.includes(' ')).map((v) => v.id);
check('at least one palette id contains a space (07 §0 regression)', spaced.length > 0, spaced.join(', '));
for (const id of spaced) {
  check(`spaced id resolves: ${id}`, resolveVoice(id) === id);
}

// --------------------------------------------------------------------- V3

/** Every `templates/<world>/characters/<id>/README.md`. */
function characterReadmes() {
  const out = [];
  const templates = path.join(REPO, 'templates');
  if (!fs.existsSync(templates)) return out;
  for (const world of fs.readdirSync(templates, { withFileTypes: true })) {
    if (!world.isDirectory() || isExperimentalWorld(templates, world.name)) continue;
    const chars = path.join(templates, world.name, 'characters');
    if (!fs.existsSync(chars)) continue;
    for (const c of fs.readdirSync(chars, { withFileTypes: true })) {
      if (!c.isDirectory()) continue;
      const readme = path.join(chars, c.name, 'README.md');
      if (fs.existsSync(readme)) out.push({ world: world.name, id: c.name, file: readme });
    }
  }
  return out;
}

const readmes = characterReadmes();
check('character README walk finds the corpus', readmes.length > 0, `${readmes.length} found`);

/**
 * world → [{ id, voice }] where `voice` is the RESOLVED wire id. An undeclared
 * character carries the server default rather than `null`: see V4.
 */
const byWorld = new Map();
/** The voice an undeclared character actually speaks in (tts.ts:41, :64). */
const DEFAULT_VOICE_RAW = process.env.AIRP_TTS_DEFAULT_VOICE ?? 'Cherry';
const DEFAULT_VOICE = resolveVoice(DEFAULT_VOICE_RAW) ?? DEFAULT_VOICE_RAW;

/** A template's spoken language, from `world.json#locale` (what the server reads). */
const languageCache = new Map();
function worldLanguage(world) {
  if (!languageCache.has(world)) {
    let locale;
    try {
      locale = JSON.parse(fs.readFileSync(path.join(REPO, 'templates', world, 'world.json'), 'utf-8')).locale;
    } catch { /* no manifest → English, like the server */ }
    languageCache.set(world, worldLanguageOf(locale));
  }
  return languageCache.get(world);
}
/** [world, character, declared, cast] for V7. */
const casts = [];

for (const { world, id, file } of readmes) {
  const { frontmatter } = parseFrontmatter(fs.readFileSync(file, 'utf-8'));
  const raw = frontmatter?.voice;
  const where = `${rel(file)}`;
  // A character's other forms speak too: each form voice must resolve.
  for (const [form, entry] of Object.entries(frontmatter?.forms ?? {})) {
    if (typeof entry?.voice !== 'string') continue;
    check(`${where}: forms.${form}.voice "${entry.voice}" resolves`, resolveVoiceFor(entry.voice.trim(), worldLanguage(world)) !== null);
  }

  if (raw === undefined || raw === null) {
    // No declaration = the server default. Legal, and worth SEEING: a world
    // whose characters are all voiceless is a content decision, not a bug.
    // It is NOT a free pass (V4): the default is a real voice, so an undeclared
    // character shares it with every other undeclared one and with anyone who
    // declares it explicitly.
    const spoken = resolveVoiceFor(DEFAULT_VOICE_RAW, worldLanguage(world)) ?? DEFAULT_VOICE;
    console.log(`  --  ${where}: no voice declared (server default = ${spoken})`);
    if (!byWorld.has(world)) byWorld.set(world, []);
    byWorld.get(world).push({ id, voice: spoken });
    continue;
  }

  if (typeof raw !== 'string' || raw.trim() === '') {
    check(`${where}: voice is a non-empty string`, false, JSON.stringify(raw));
    continue;
  }

  const declared = raw.trim();
  const resolved = resolveVoice(declared);
  check(
    `${where}: voice "${declared}" resolves`,
    resolved !== null,
    resolved === null
      ? `not in the palette — add it to packages/shared/src/rules/voices.ts (07 §5) or use an alias from the table`
      : ''
  );

  // The whole point of the alias vocabulary: a raw id is accepted for
  // compatibility, but new content should name the EFFECT (07 §2).
  if (resolved !== null && declared === resolved && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(declared)) {
    console.warn(`  ~~  ${where}: declares the raw id "${declared}"; prefer its effect alias (07 §2)`);
  }

  if (!byWorld.has(world)) byWorld.set(world, []);
  // An unresolved declaration already failed V3; do not also count it as a
  // voice here (two typos in one world would then read as a collision).
  if (resolved === null) continue;
  // The voice the character ACTUALLY speaks in this world's language.
  const spoken = resolveVoiceFor(declared, worldLanguage(world));
  casts.push({ world, id, declared, spoken });
  byWorld.get(world).push({ id, voice: spoken ?? resolved });
}

// --------------------------------------------------------------------- V4

// Two characters in the SAME world sharing one voice makes them
// indistinguishable when both can speak; across worlds it is fine (the same
// actor, or a deliberate house style).
//
// Undeclared characters are counted here as the DEFAULT voice, not skipped:
// the earlier `filter(v => v !== null)` let two voiceless characters collide in
// playback (both fall to the server default) while the gate stayed green — a
// hole that a reviewer caught. The voice a character ACTUALLY speaks in is the
// only thing worth comparing.
for (const [world, chars] of byWorld) {
  const voices = chars.map((c) => c.voice);
  const dupes = voices.filter((v, i) => voices.indexOf(v) !== i);
  check(
    `${world}: no two characters share a voice`,
    dupes.length === 0,
    dupes.length > 0 ? `${[...new Set(dupes)].join(', ')} used by multiple characters` : ''
  );
}

// --------------------------------------------------------------------- V5

// The palette reference is a SECOND copy of the palette (08 §4.1). Hand-editing
// it is the drift this assertion forbids: the skill would advertise a voice the
// resolver no longer knows, which is the exact "correct-looking but wrong" state
// the alias vocabulary exists to prevent.
const expectedRef = renderPaletteRef();
if (!fs.existsSync(REF_PATH)) {
  check(`${rel(REF_PATH)} exists (run with --write-ref)`, false, 'missing');
} else {
  const actualRef = fs.readFileSync(REF_PATH, 'utf-8');
  check(
    `${rel(REF_PATH)} matches the palette (08 §4.1)`,
    actualRef === expectedRef,
    'stale — run `node tools/check-voices.mjs --write-ref`'
  );
}

// --------------------------------------------------------------------- V6

// The per-language tables: in every world language, every
// alias is cast on a voice that SPEAKS that language and keeps the alias's
// gender. A language-bound voice (dialect, American English) is re-cast, never
// used across languages.
for (const language of WORLD_LANGUAGES) {
  for (const v of VOICES) {
    const cast = castVoice(v.alias, language);
    check(
      `V6 [${language}] ${v.alias} (${v.gender}) → ${cast?.id ?? 'none'}`,
      cast !== undefined && voiceSpeaks(cast, language) && cast.gender === v.gender,
      cast === undefined ? 'no voice in this language' : `speaks ${cast.native ?? 'all'}, ${cast.gender}`
    );
  }
}

// --------------------------------------------------------------------- V7

// Every edition × character: the voice actually spoken is in the WORLD'S
// language and of the DECLARED gender. This is the Vera / 华生 class of bug —
// a voice from another language, or the other gender, reaching a world.
check('V7 walk finds declared characters', casts.length > 0, `${casts.length}`);
for (const { world, id, declared, spoken } of casts) {
  const language = worldLanguage(world);
  const entry = spoken ? voiceEntry(spoken) : undefined;
  const want = voiceEntry(declared);
  check(
    `V7 ${world}/${id}: ${declared} → ${spoken} speaks ${language}, ${want?.gender}`,
    entry !== undefined && voiceSpeaks(entry, language) && entry.gender === want?.gender,
    entry ? `speaks ${entry.native ?? 'all'}, ${entry.gender}` : 'no voice'
  );
}

// --------------------------------------------------------------------- V8

// Which voice a character speaks with comes from worldlines-play now
// This gate stays offline, so it checks the two things this repo still owns:
//   - the snapshot file (kept for now, refreshed by tools/sync-voice-roster.mjs) is a valid roster;
//   - every character of every edition gets a voice from the BUILT-IN fallback (apps/server builtin-voices.ts, what tts.ts
//     speaks with when play cannot be asked): a native Fish voice of its sex × age band in its world language. Where qwen has
//     no native voice of that sex in that language (no Japanese / Korean qwen man), the character is LISTED: on a qwen-only
//     route it gets a 503, never a forced voice.
// Opt-in against a running play service (a local one, or a test double): AIRP_PLAY_URL + AIRP_PLAY_TOKEN → every character
// must get at least one candidate from it too.
const rosterProblems = validateRoster(VOICE_ROSTER);
check('V8 the voice roster snapshot is valid', rosterProblems.length === 0, rosterProblems.join('; '));
const { builtinCandidates } = await import('../apps/server/dist/builtin-voices.js');
const playBase = (process.env.AIRP_PLAY_URL ?? '').trim().replace(/\/+$/, '');
const playToken = (process.env.AIRP_PLAY_TOKEN ?? '').trim();
const noQwen = [];
for (const { world, id, file } of readmes) {
  const { frontmatter } = parseFrontmatter(fs.readFileSync(file, 'utf-8'));
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'templates', world, 'world.json'), 'utf-8')); } catch { /* no manifest */ }
  const description = manifest.characters?.find((c) => c.id === id)?.description ?? '';
  const lang = worldLanguageOf(manifest.locale);
  const profile = inferVoiceProfile(description, frontmatter?.gender);
  const fish = builtinCandidates({ providers: ['fish'], lang, gender: profile.gender, age: profile.age });
  check(`V8 ${world}/${id}: a built-in ${lang} Fish voice`, fish.length === 1, 'no built-in voice');
  if (!builtinCandidates({ providers: ['dashscope'], lang, gender: profile.gender, age: profile.age }).length) noQwen.push(`${world}/${id} (${lang}, ${profile.gender ?? '?'})`);
  if (playBase && playToken) {
    const family = String(manifest.id ?? world).replace(/-(?:zh|jp|ja|ko|en)$/, '');
    const r = await fetch(`${playBase}/v1/voice/cast`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${playToken}` }, body: JSON.stringify({ product: 'livingcanvas', family, character: id, lang, description, providers: ['fish', 'dashscope'] }) }).then((x) => x.json()).catch(() => null);
    check(`V8 ${world}/${id}: play gives a candidate`, Boolean(r?.candidates?.length), 'no candidate from play');
  }
}
// --------------------------------------------------------------------- V9

// the team's per-character voices (worldlines-assets voices/assignments.json, 2026-10-18): the built-in copy
// (builtin-voices.ts BUILTIN_ASSIGNED) equals the roster snapshot's assignedVoices; every one is a roster Fish voice that
// speaks its language; every edition's assigned character gets it first on a Fish route. Assignments no template character
// matches (family / character id) are LISTED, not failed — the character may not be in LivingCanvas yet.
const { BUILTIN_ASSIGNED } = await import('../apps/server/dist/builtin-voices.js');
const sorted = (o) => JSON.stringify(o, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
check('V9 built-in assigned voices = the roster snapshot\'s assignedVoices', sorted(BUILTIN_ASSIGNED) === sorted(VOICE_ROSTER.assignedVoices ?? {}), 'copy VOICE_ROSTER.assignedVoices into builtin-voices.ts');
for (const [family, souls] of Object.entries(BUILTIN_ASSIGNED)) for (const [soul, set] of Object.entries(souls)) for (const lang of WORLD_LANGUAGES) {
  const v = VOICE_ROSTER.voices.find((x) => x.id === set[lang]);
  const only = v?.only === undefined ? undefined : [v.only].flat();
  check(`V9 ${family}/${soul} [${lang}] ${set[lang]} is a roster Fish voice speaking ${lang}`, Boolean(v && v.provider === 'fish' && !VOICE_ROSTER.banned.includes(v.id) && (!only || only.includes(lang))), v ? `${v.provider}, only ${JSON.stringify(v.only)}` : 'not in the roster');
}
const matched = new Set();
for (const world of fs.readdirSync(path.join(REPO, 'templates'), { withFileTypes: true })) {
  if (!world.isDirectory()) continue;
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'templates', world.name, 'world.json'), 'utf-8')); } catch { continue; }
  const family = String(manifest.id ?? world.name).replace(/-(?:zh|jp|ja|ko|en)$/, '');
  const lang = worldLanguageOf(manifest.locale);
  for (const c of manifest.characters ?? []) {
    const set = BUILTIN_ASSIGNED[family]?.[c.id];
    if (!set) continue;
    matched.add(`${family}/${c.id}`);
    const first = builtinCandidates({ providers: ['fish', 'dashscope'], lang, family, character: c.id })[0];
    check(`V9 ${world.name}/${c.id} [${lang}]: niko's voice ${set[lang]}`, first?.provider === 'fish' && first.voiceId === set[lang] && first.via === 'assigned', JSON.stringify(first));
  }
}
const unmatched = Object.entries(BUILTIN_ASSIGNED).flatMap(([family, souls]) => Object.keys(souls).map((soul) => `${family}/${soul}`)).filter((k) => !matched.has(k));
if (unmatched.length) console.warn(`  ~~  V9 assigned voices with no template character (${unmatched.length}): ${unmatched.join(', ')}`);

if (noQwen.length) console.warn(`  ~~  V8 no native built-in qwen voice (qwen-only routes answer 503 for these) (${noQwen.length}):\n      ${noQwen.join('\n      ')}`);

console.log(`\n${failed === 0 ? 'ALL VOICE-CORPUS ASSERTIONS PASSED' : `${failed} ASSERTION(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
