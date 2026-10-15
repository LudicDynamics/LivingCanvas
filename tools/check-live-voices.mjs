#!/usr/bin/env node
/**
 * GPT-Live voice gate (`pnpm check:live-voices`) — the design notes, §2.6.
 *
 * The bug this exists to catch: `POST /v1/live/sessions` rejects an unknown
 * voice with HTTP 403 `forbidden` (measured: `girl-next-door`, `Cherry`). So a
 * character whose README resolves to a voice OUTSIDE `LIVE_VOICES` does not
 * fall back — the whole call fails at the OpenAI boundary. Unlike the TTS
 * palette (`resolveVoice` → `null` → server default), `resolveLiveVoice` NEVER
 * returns null; the fallback is only proven by asserting the RESULT, never the
 * input.
 *
 * Four assertions (00 §9.3; L4 from 13 §2.4):
 *   L1  `resolveLiveVoice(undefined)` and unknown input return a value INSIDE
 *       `LIVE_VOICES` — the fallback itself is whitelisted.
 *   L2  every template character README's `voice:` (including the ones that
 *       declare none) resolves into `LIVE_VOICES`. A missing declaration is
 *       normal and legal; the assertion is on the RESOLVED voice, not the input.
 *   L3  every `LIVE_VOICES` entry is among the 22 names actually measured to
 *       work (00 §12 P5+P6). A whitelist may not grow an unverified name — the
 * same discipline as the design notes
 *   L4  every palette alias is cast on a Live voice of its OWN gender, per
 * `LIVE_VOICE_GENDER`.
 *
 * L3 is why the 22-name list is duplicated here: it is the ONE copy of the
 * measurement, and a name added to the whitelist without being re-measured
 * turns this gate red by design. This is a CONTENT gate, not a runtime one: it
 * never touches the network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LIVE_VOICES,
  DEFAULT_LIVE_VOICE,
  LIVE_VOICE_GENDER,
  VOICES,
  liveVoiceForAlias,
  resolveLiveVoice,
  voiceEntry,
} from '../packages/shared/dist/index.js';
import { isExperimentalWorld } from './world-editions.mjs';
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

/** The 22 names measured against `POST /v1/live/sessions` (00 §12 P5+P6). */
const MEASURED = [
  // P5 — OpenAI's own gpt-live-1 set (12).
  'quartz', 'ripple', 'vesper', 'willow', 'stone', 'gleam',
  'meridian', 'bossa', 'tempo', 'beacon', 'delta', 'cinder',
  // P6 — other candidates that returned HTTP 201.
  'marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse',
];

// --------------------------------------------------------------------- L0

// A vacuous pass would hide everything below: an empty whitelist resolves
// nothing, and an empty README walk checks nothing.
check('LIVE_VOICES is non-empty', LIVE_VOICES.length > 0, `${LIVE_VOICES.length} entries`);
assert.ok(LIVE_VOICES.length > 0, 'LIVE_VOICES is empty — the import is wrong, not the corpus');

const missingDist = !fs.existsSync(path.join(REPO, 'packages/shared/dist/rules/voices.js'));
if (missingDist) {
  console.error(
    '\npackages/shared/dist/rules/voices.js is missing — run `pnpm --filter @airp/shared build` first (AGENTS.md §6.5).'
  );
  process.exit(1);
}

const inWhitelist = (voice) => LIVE_VOICES.includes(voice);

// --------------------------------------------------------------------- L1

// The fallback is the value every undeclared/typo'd character actually speaks
// in, so it MUST itself be a whitelisted name. `girl-next-door` and `Cherry`
// (00 §12 P7) are the near-misses worth pinning: they are real TTS voices, so
// they read as plausible — and are exactly what the 403 boundary forbids.
check(
  `resolveLiveVoice(undefined) → ${resolveLiveVoice(undefined)} is whitelisted`,
  inWhitelist(resolveLiveVoice(undefined)),
  resolveLiveVoice(undefined)
);
for (const bogus of ['girl-next-door', 'Cherry', 'nonexistent', '']) {
  const got = resolveLiveVoice(bogus);
  check(
    `resolveLiveVoice(${JSON.stringify(bogus)}) → ${got} is whitelisted`,
    inWhitelist(got),
    got
  );
}
check(
  `DEFAULT_LIVE_VOICE (${DEFAULT_LIVE_VOICE}) is whitelisted`,
  inWhitelist(DEFAULT_LIVE_VOICE),
  DEFAULT_LIVE_VOICE
);

// --------------------------------------------------------------------- L2

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

for (const { file } of readmes) {
  const { frontmatter } = parseFrontmatter(fs.readFileSync(file, 'utf-8'));
  const raw = frontmatter?.voice;
  const where = rel(file);

  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    // No declaration = the call falls to the default. Legal, and worth SEEING:
    // the assertion is that the RESULT is whitelisted, not the input.
    const got = resolveLiveVoice(undefined);
    console.log(`  --  ${where}: no voice declared (live default = ${got})`);
    check(`${where}: undeclared voice resolves into LIVE_VOICES`, inWhitelist(got), got);
    continue;
  }

  if (typeof raw !== 'string') {
    check(`${where}: voice is a string`, false, JSON.stringify(raw));
    continue;
  }

  const declared = raw.trim();
  // The RESOLVED-whitelisted assertion alone can never fail: `resolveLiveVoice`
  // maps anything unknown to the (whitelisted) default, so a typo would sail
  // through green. Mirroring the design notes ("near-misses are not silently
  // accepted"), the declaration itself must be a known palette entry — alias or
  // raw id — or the character silently speaks in the default voice on a call.
  check(
    `${where}: voice "${declared}" is a known palette entry`,
    voiceEntry(declared) !== undefined,
    'not in the palette — fix the typo, or add the effect alias to packages/shared/src/rules/voices.ts (07 §5)'
  );
  const resolved = resolveLiveVoice(declared);
  check(
    `${where}: voice "${declared}" → ${resolved} is whitelisted`,
    inWhitelist(resolved),
    resolved
  );
  // GPT Live voices are multilingual, so the world's language needs no re-cast
  // here — but the character's gender does.
  const wanted = voiceEntry(declared)?.gender;
  if (wanted) {
    check(
      `${where}: live voice ${resolved} keeps the declared gender (${wanted})`,
      LIVE_VOICE_GENDER[resolved] === wanted,
      `${resolved} is ${LIVE_VOICE_GENDER[resolved] ?? 'unheard'}`
    );
  }
}

// --------------------------------------------------------------------- L3

// The whitelist is a promise that every name synthesises. A name added without
// a fresh measurement is the exact "correct-looking but wrong" state the 403
// boundary punishes — so every whitelist entry MUST appear in the recorded run.
const measuredSet = new Set(MEASURED);
for (const voice of LIVE_VOICES) {
  check(
    `LIVE_VOICES entry "${voice}" was measured (00 §12)`,
    measuredSet.has(voice),
    'not in the 22 measured names — re-measure before whitelisting (00 §12 P5/P6)'
  );
}
// And the two sets must agree in SIZE, or a measured name was silently dropped
// from the whitelist (a valid voice nobody may use — also a defect).
check(
  `LIVE_VOICES covers all ${MEASURED.length} measured names`,
  LIVE_VOICES.length === MEASURED.length &&
    MEASURED.every((v) => LIVE_VOICES.includes(v)),
  `whitelist has ${LIVE_VOICES.length}, measured ${MEASURED.length}`
);

// --------------------------------------------------------------------- L4

// Same gender, same-gender voice. A male character
// cast as `alloy` (androgynous) or a female one cast as `ballad` (male) is the
// "every call sounds like a woman" bug; an alias cast on an UNHEARD voice (not
// in LIVE_VOICE_GENDER) fails too, because its gender is unknown.
for (const { alias, gender } of VOICES) {
  const live = liveVoiceForAlias(alias);
  const liveGender = live === undefined ? undefined : LIVE_VOICE_GENDER[live];
  check(
    `L4 ${alias} (${gender}) → ${live} (${liveGender ?? 'unheard'}) keeps its gender`,
    liveGender === gender,
    live === undefined ? 'alias has no Live cast' : `cast on a ${liveGender ?? 'gender-unknown'} voice`
  );
}

console.log(`\n${failed === 0 ? 'ALL GPT-LIVE VOICE ASSERTIONS PASSED' : `${failed} ASSERTION(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
