#!/usr/bin/env node
/**
 * Skill-corpus gate — the design notes §⑧ (the fourth mechanical check).
 *
 * `00 §8` lists three gates; `04:611-642` registers this as the fourth for the
 * skill corpus. It is PURE FILE assertions (no engine, no spawn) and covers
 * 04 §⑧ A1–A8 and A10–A13. **A9 is deliberately absent**: it is the end-to-end
 * spawn and lives in `tools/probe-prompt.mjs` / `probe-prompt-character.mjs`.
 *
 * Why each assertion exists (04 §⑦ — a malformed skill is dropped SILENTLY, so
 * only a test can catch it):
 *   - a missing/blank/array `description` makes `core/skills.ts:304-306` skip the
 *     skill — invisible, no warning (A1/A13);
 *   - an unquoted `: ` inside a description makes the YAML parser throw
 *     `Nested mappings…` and the skill is dropped (A13 / 04 C6, the
 *     `holmes-world-style` near-miss);
 *   - a root-level `.md` WITH a `description` becomes a bogus skill named README
 *     (A12);
 *   - platform prose must be English and a `locale: ja` world's prose Japanese,
 *     or the language layering never actually landed (A2/A3/A4).
 *
 * Run: node tools/check-skills.mjs        (pnpm check:skills)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter } from '../vendor/pi-rp/packages/coding-agent/dist/utils/frontmatter.js';
import { isExperimentalWorld } from './world-editions.mjs';


const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rel = (abs) => path.relative(REPO, abs).split(path.sep).join('/');

const CJK = /[\u4e00-\u9fff\u3040-\u30ff]/;
/** Hangul syllables + jamo: a Korean (`ko`) world's skills are written in Korean. */
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/;
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const GENERIC_DESC_RE = /helps? with|关于.*的帮助|misc/i;
const ILLEGAL_TOOL_RE = /get_state|set_state|state_update|watch_state/;
/**
 * A7: each platform skill's description must name at least two concrete
 * triggers. The vocabulary is PER SKILL — a shared list would
 * pass a voice skill that happens to mention `roll_dice`, which is not its
 * trigger, while saying nothing about voices.
 */
const TRIGGERS_BY_SKILL = {
  'component-narration': ['note', 'letter', 'chalk', 'get_component'],
  'tool-craft': ['move_to', 'show', 'choice', 'roll_dice', 'link', 'chalk'],
  'voice-casting': ['voice', 'README', 'palette', 'character'],
  'scene-initialization': ['scene-init', 'airp-init', 'README', 'choice', 'roll_dice'],
  'abstract-directory-story': ['directory', 'time', 'parallel', 'decision', 'ending'],
  'nook-management': ['character', 'move', 'move_to', 'memory', 'player', 'world'],
  'world-workshop': ['AUTHOR', 'workshop', 'README', 'generate_image', 'create_char', 'map'],
  // A7 needs two CONCRETE triggers named in the description. This skill's
  // trigger is architectural (the player acts without the agent present), so
  // the words are the three paths that bypass it.
  'world-commands': ['command', 'on', 'dice', 'choice'],
  'html-canvas': ['html', 'page', 'airp-design', 'sandbox'],
};
/** A0: the platform tier's exact membership. Adding a skill MUST update this. */
const EXPECTED_PLATFORM = Object.keys(TRIGGERS_BY_SKILL);

const PLATFORM_DIR = path.join(REPO, 'skills');
const SKILL_BODY_MAX_LINES = 120;

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ' :: ' + extra : ''}`);
  if (!ok) failed++;
};

/**
 * Every `<tier>/<world>/skills` directory that exists.
 *
 * `templates/` is the shipped corpus. `worlds/` holds per-machine SAVES — an
 * untracked copy of a template with the player's own runtime state — and a save
 * carries the SAME skill names as the template it came from, so including it
 * made A10 (globally-unique names) fail by construction the moment anyone
 * played a world. The rule A10 actually states is "unique across the shipped
 * corpus", which is `templates/` only.
 *
 * Experimental sandboxes (`exp: true`) are outside that corpus too.
 */
function worldSkillDirs() {
  const out = [];
  for (const tier of ['templates']) {
    const tierDir = path.join(REPO, tier);
    if (!fs.existsSync(tierDir)) continue;
    for (const world of fs.readdirSync(tierDir)) {
      if (isExperimentalWorld(tierDir, world)) continue;
      const dir = path.join(tierDir, world, 'skills');
      if (fs.existsSync(dir)) out.push({ world, dir });
    }
  }
  return out.sort((a, b) => a.world.localeCompare(b.world));
}

/** Every `SKILL.md` directly under `dir` (and one level deeper, matching pi-rp). */
function skillFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const nested = path.join(dir, entry.name, 'SKILL.md');
      if (fs.existsSync(nested)) out.push(nested);
    }
  }
  return out.sort();
}

/** Body line count, excluding the frontmatter block. */
function bodyLines(body) {
  const trimmed = body.replace(/^\n+/, '').replace(/\s+$/, '');
  return trimmed === '' ? 0 : trimmed.split('\n').length;
}

const read = (file) => fs.readFileSync(file, 'utf-8');

const platformFiles = skillFiles(PLATFORM_DIR);
const worldDirs = worldSkillDirs();
const worldFiles = worldDirs.flatMap(({ dir }) => skillFiles(dir));
const allFiles = [...platformFiles, ...worldFiles];

// --------------------------------------------------------------------------- A0

check(
  `the corpus matches the expected platform set (${EXPECTED_PLATFORM.length})`,
  platformFiles.length === EXPECTED_PLATFORM.length,
  `${platformFiles.length} found: ${platformFiles.map((f) => path.basename(path.dirname(f))).join(', ')}`
);
for (const name of EXPECTED_PLATFORM) {
  check(
    `platform skill "${name}" exists`,
    fs.existsSync(path.join(PLATFORM_DIR, name, 'SKILL.md'))
  );
}
assert.ok(
  allFiles.length > 0,
  'no SKILL.md found — the walk is wrong, not the corpus (a vacuous pass would hide everything below)',
);

// --------------------------------------------------------------------------- A1 + A13

/** Parse every skill once; A1/A11/A13 share the result. */
const parsed = new Map();
for (const file of allFiles) {
  const fm = parseFrontmatter(read(file)).frontmatter;
  parsed.set(file, fm);
  const name = fm.name;
  const description = fm.description;
  check(`${rel(file)}: name matches ^[a-z0-9]+(-[a-z0-9]+)*$ and <= 64`, typeof name === 'string' && NAME_RE.test(name) && name.length <= 64, JSON.stringify(name));
  // A13: `parseFrontmatter` on an unquoted `: ` throws, and a `[...]` value parses
  // to an array — both are strings only when the file is honestly well-formed.
  check(`${rel(file)}: description parses to a non-empty string (A13)`, typeof description === 'string' && description.trim().length > 0, typeof description);
  check(`${rel(file)}: description <= 1024 chars`, typeof description === 'string' && description.length <= 1024, typeof description === 'string' ? `${description.length}` : typeof description);
}

// --------------------------------------------------------------------------- A11

for (const file of allFiles) {
  const dirName = path.basename(path.dirname(file));
  check(`${rel(file)}: directory name == frontmatter name`, dirName === parsed.get(file).name, `${dirName} vs ${parsed.get(file).name}`);
}

// --------------------------------------------------------------------------- A2

for (const file of platformFiles) {
  const src = read(file);
  const description = parsed.get(file).description;
  check(`${rel(file)}: platform description and body contain no CJK (AGENTS.md §1.1)`, !CJK.test(description) && !CJK.test(src));
}

// --------------------------------------------------------------------------- A7

for (const file of platformFiles) {
  const name = parsed.get(file).name;
  const description = parsed.get(file).description;
  const triggers = TRIGGERS_BY_SKILL[name];
  check(`${rel(file)}: has a trigger vocabulary (08 §4.3)`, Array.isArray(triggers), name);
  if (!Array.isArray(triggers)) continue;
  const hits = triggers.filter((n) => new RegExp(`\\b${n}\\b`).test(description));
  check(`${rel(file)}: platform description names >= 2 concrete triggers (04 A7)`, hits.length >= 2, hits.join(','));
}

// --------------------------------------------------------------------------- A5

for (const file of allFiles) {
  const lines = bodyLines(parseFrontmatter(read(file)).body);
  check(`${rel(file)}: body <= ${SKILL_BODY_MAX_LINES} lines (progressive disclosure, 04 A5)`, lines <= SKILL_BODY_MAX_LINES, `${lines} lines`);
}

// --------------------------------------------------------------------------- A6

for (const file of allFiles) {
  const description = parsed.get(file).description;
  check(`${rel(file)}: description has no generic filler (04 A6)`, !GENERIC_DESC_RE.test(description), description);
}

// --------------------------------------------------------------------------- A8

for (const file of allFiles) {
  check(`${rel(file)}: mentions no illegal tool name (00 §5)`, !ILLEGAL_TOOL_RE.test(read(file)));
}

// --------------------------------------------------------------------------- A3 + A4

// Language layering: a `locale: ja` world's skills must be Japanese (in both the
// description and the body); an English/default-locale world's must not be. Both
// are CONDITIONAL on the directory existing — 04 §2.1 only builds two worlds, and
// the other four must not be assumed to have skills (review B2).
for (const { world, dir } of worldDirs) {
  let locale;
  for (const candidate of [path.join(REPO, 'templates', world, 'world.json'), path.join(REPO, 'worlds', world, 'world.json')]) {
    if (fs.existsSync(candidate)) {
      locale = JSON.parse(read(candidate)).locale;
      break;
    }
  }
  // Japanese and Chinese (`zh-CN`) editions both write their skills in CJK.
  const isCjkWorld = locale === 'ja' || locale === 'zh-CN';
  // Korean editions (2026-10-03) write their skills in Hangul, and never in kana.
  const isKoreanWorld = locale === 'ko';
  for (const file of skillFiles(dir)) {
    const { frontmatter, body } = parseFrontmatter(read(file));
    const name = frontmatter.name;
    // The name is a program identifier — always ASCII, whatever the locale (00 §4.3).
    check(`${rel(file)}: name is ASCII even in a ${locale ?? 'default'} world`, typeof name === 'string' && !CJK.test(name), name);
    if (isCjkWorld) {
      check(`${rel(file)}: a locale:${locale} world's description and body are in its language (04 A3/A4)`, CJK.test(frontmatter.description) && CJK.test(body));
    } else if (isKoreanWorld) {
      check(`${rel(file)}: a locale:ko world's description and body are in Korean (04 A3/A4)`, HANGUL.test(frontmatter.description) && HANGUL.test(body));
    } else {
      check(`${rel(file)}: a non-CJK world's description and body are not CJK (04 A4)`, !CJK.test(frontmatter.description) && !CJK.test(body));
    }
  }
}

// --------------------------------------------------------------------------- A10

const names = allFiles.map((f) => parsed.get(f).name);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
check('skill names are globally unique across platform + worlds (04 A10)', dupes.length === 0, [...new Set(dupes)].join(','));

// --------------------------------------------------------------------------- A12

// Root-level `.md` next to `SKILL.md` (the READMEs) is a load candidate
// (`core/skills.ts:262`); it is skipped only because it has no `description`.
// Asserting that here keeps "README never becomes a skill" a file-level fact.
for (const dir of [PLATFORM_DIR, ...worldDirs.map((w) => w.dir)]) {
  if (!fs.existsSync(dir)) continue;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const file = path.join(dir, entry.name);
    const fm = parseFrontmatter(read(file)).frontmatter;
    check(`${rel(file)}: root-level .md has no description (must not become a README skill, 04 A12)`, fm.description === undefined, String(fm.description));
  }
}


// A14 (component-kind grounding) was proposed by the plot-skill review and is
// deliberately NOT implemented: the failure it targets ("board" named as if it
// were a landed kind) appears in *prose*, and "board"/"letter"/"note" are
// ordinary English words, so any regex either misses the real case or floods on
// legitimate prose. A check that can only fire when the miss is already
// backticked is a green wash. The honest guard is human review of plot skills
// (`the design notes`), not a file assertion. Recorded here so
// the gap is not mistaken for coverage.

console.log(`\n${failed === 0 ? 'ALL SKILL-CORPUS ASSERTIONS PASSED' : `${failed} ASSERTION(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
