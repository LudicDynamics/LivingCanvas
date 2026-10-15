/**
 * tools/skill-html-canvas.test.mjs — behaviour proof for the html-canvas platform skill (M12).
 *
 * The gate (`tools/check-skills.mjs`) covers A0–A13 for `SKILL.md` only. Two things it cannot see
 * are proven here, because "the gate is green" is not the same as "the deliverable works":
 *
 *   1. the referenced file exists (§11 C1: two other platform skills point at references that were
 *      never written, and no assertion notices);
 *   2. the skill's own hard rules hold — English-only, no identity words (§6.11), and the skeleton
 *      actually carries the pieces the body tells the reader to write.
 *
 * Every pattern that guards a rule is first shown to fire on a violating sample, so a green run
 * cannot be the green of a pattern that matches nothing (the `\bcharacter\b` false-green in §6.1).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(TOOLS);
const SKILL_DIR = path.join(REPO, 'skills', 'html-canvas');
const SKILL = path.join(SKILL_DIR, 'SKILL.md');
const REFERENCE = path.join(SKILL_DIR, 'references', 'page-skeleton.md');

const read = (file) => fs.readFileSync(file, 'utf-8');

/** The body, with the frontmatter block removed (same split as the gate). */
const bodyOf = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, '');
const descriptionOf = (text) => text.match(/^description: "(.*)"$/m)[1];

const CJK = /[\u4e00-\u9fff\u3040-\u30ff]/;
const IDENTITY = /\bwriter\b/;

const SKILL_TEXT = read(SKILL);
const SKILL_BODY = bodyOf(SKILL_TEXT);
const DESCRIPTION = descriptionOf(SKILL_TEXT);
const REFERENCE_TEXT = read(REFERENCE);

// ── the guards fire (a green run below means something) ──────────────────────

test('the CJK guard matches real CJK and not English', () => {
  assert.ok(CJK.test('一段中文正文'));
  assert.ok(CJK.test('カタカナ'));
  assert.ok(!CJK.test(SKILL_BODY));
});

test('the identity guard matches an identity sentence', () => {
  assert.ok(IDENTITY.test('As the writer, you should reach for this skill.'));
  assert.ok(!IDENTITY.test(SKILL_BODY));
  assert.ok(!IDENTITY.test(DESCRIPTION));
});

// ── §6.1 / A2: platform-tier corpus is English and identity-neutral ──────────

test('description names at least two of this skill own triggers (A7)', () => {
  const hits = ['html', 'page', 'airp-design', 'sandbox'].filter((word) => DESCRIPTION.includes(word));
  assert.ok(hits.length >= 2, `only ${hits.length} trigger(s): ${hits.join(',')}`);
});

test('the body never assumes an identity, `character` appears only in paths', () => {
  // Deliberately WITHOUT \b: `\bcharacter\b` does not match `characters` (no boundary after the
  // `s`), which is exactly the line the paths are written on.
  const lines = SKILL_BODY.split('\n').filter((line) => line.includes('character'));
  assert.ok(lines.length > 0, 'the unanchored guard must be able to see `characters/<id>/`');
  for (const line of lines) {
    assert.match(line, /characters\//, `a bare identity word slipped in: ${line}`);
  }
});

test('the reference is English too (A2 does not scan references — §11 C2)', () => {
  assert.ok(!CJK.test(REFERENCE_TEXT), 'references/page-skeleton.md contains CJK');
});

// ── §8.1 / T7: the pointer resolves (no dangling reference) ──────────────────

test('every `references/<x>.md` the body points at exists on disk', () => {
  const refs = [...SKILL_BODY.matchAll(/`references\/([A-Za-z0-9._-]+\.md)`/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, 'the body must end with a pointer to its reference file');
  for (const name of refs) {
    const target = path.join(SKILL_DIR, 'references', name);
    assert.ok(fs.existsSync(target), `dangling reference: references/${name}`);
  }
});

test('the reference has no dangling pointer of its own', () => {
  const refs = [...REFERENCE_TEXT.matchAll(/`references\/([A-Za-z0-9._-]+\.md)`/g)].map((m) => m[1]);
  assert.deepEqual(refs, []);
});

// ── §8.3: the skeleton really carries what the body promises ────────────────

/** First fenced ```html block — the one piece a reader copies. */
const firstHtmlBlock = (text) => {
  const match = text.match(/```html\n([\s\S]*?)```/);
  assert.ok(match, 'the reference must open with a complete, copyable html block');
  return match[1];
};

test('the copyable page carries the three head fields the body promises', () => {
  const block = firstHtmlBlock(REFERENCE_TEXT);
  assert.match(block, /<title>[^<]+<\/title>/);
  assert.match(block, /<meta name="description" content="[^"]+">/);
  assert.match(block, new RegExp('<meta name="airp-design" content="(?:' + 'desktop|tablet|phone' + ')">'));
});

test('the copyable page is self-contained: inline style, inline script, data: URI', () => {
  const block = firstHtmlBlock(REFERENCE_TEXT);
  assert.match(block, /<style>/);
  assert.match(block, /<script>/);
  assert.match(block, /src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"/);
  assert.ok(!/src="\.\.?\//.test(block), 'a relative asset path in the copyable page is the exact trap §6.3 warns about');
});

test('the reference shows the misspelled tier as broken, not as an alternative', () => {
  assert.match(REFERENCE_TEXT, /airp-design" content="laptop"/);
  assert.match(REFERENCE_TEXT, /falls back to `desktop`, silently/);
});

// ── §10.4 T1/T2/T5: the gate itself, plus its non-emptiness ─────────────────

const runGate = (script) => spawnSync(process.execPath, [script], { cwd: REPO, encoding: 'utf-8' });

test('the skill corpus gate passes and counts this skill', () => {
  const result = runGate(path.join(TOOLS, 'check-skills.mjs'));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /expected platform set \(9\)/);
  assert.match(result.stdout, /platform skill "html-canvas" exists/);
  assert.match(result.stdout, /names >= 2 concrete triggers \(04 A7\) :: html,page,airp-design,sandbox/);
  assert.match(result.stdout, /html-canvas\/SKILL\.md: body <= 120 lines .* :: (\d+) lines/);
  assert.ok(Number(result.stdout.match(/html-canvas\/SKILL\.md: body <= 120 lines .* :: (\d+) lines/)[1]) <= 120);
});

test('EXPECTED_PLATFORM length equals the number of skills on disk (T5)', () => {
  const skillDirs = fs
    .readdirSync(path.join(REPO, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(REPO, 'skills', entry.name, 'SKILL.md')));
  assert.equal(skillDirs.length, 9);
  assert.ok(skillDirs.map((e) => e.name).includes('html-canvas'));
});

test('dropping the trigger row makes the gate red (T4: the gate reads this skill)', () => {
  const source = read(path.join(TOOLS, 'check-skills.mjs'));
  const stripped = source.replace(/^ {2}'html-canvas': \[[^\]]*\],\n/m, '');
  assert.notEqual(stripped, source, 'the html-canvas trigger row was not found in TRIGGERS_BY_SKILL');

  const scratch = path.join(TOOLS, `.tmp-check-skills-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(scratch, stripped);
  try {
    const result = runGate(scratch);
    assert.equal(result.status, 1, 'the gate must fail when the registration row is missing');
    assert.match(result.stdout, /FAIL the corpus matches the expected platform set \(8\)/);
    assert.match(result.stdout, /FAIL skills\/html-canvas\/SKILL\.md: has a trigger vocabulary/);
    assert.match(result.stdout, /2 ASSERTION\(S\) FAILED/);
  } finally {
    fs.rmSync(scratch, { force: true });
    fs.rmSync(path.join(os.tmpdir(), path.basename(scratch)), { force: true });
  }
  assert.ok(!fs.existsSync(scratch), 'the scratch gate script must not survive the test');
});
