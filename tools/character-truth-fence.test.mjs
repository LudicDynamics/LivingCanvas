// No companion can learn the run's hidden truth by reading the world
//. For the three random-truth worlds, every run
// variant is prepared as a real save and every file in it is read the way the
// companion's read / grep would read it (packages/shared/src/rules/character-view.ts
// through extensions/toolkit/read-fence.ts):
//
//   - 最后的证人 (4 editions × 3 culprits, companion Hans): the truth is in the
//     suspect cards' `intent` and `persona`, the hidden `culprit` state and the
//     `run` record;
//   - 深夜电波 (4 truths, companion Nils): the four voice cards' `intent`, the
//     hidden `truth` state;
//   - 伪画师 (4 editions × 3 detectives, companion Martel): the hidden `cover`
//     state the first roll writes, and every probe card's `intent`.
//
// For each: no writer-only text (an `intent`, an NPC `persona`, an ending, a
// command) appears anywhere in what the companion can read or grep, no hidden
// state value survives, and the culprit's own NPC brief — what the writer
// voices them from — still carries their persona, so they lie consistently.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { skipUnlessShipped } from './shipped-worlds.mjs';
import { fileURLToPath } from 'node:url';
import { createJiti } from '../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';
import {
  buildNpcBrief,
  characterViewOf,
  characterViewText,
  hiddenStateIds,
  parseFrontmatter,
  prepareRun,
  readNpcCard,
  stringifyFrontmatter,
} from '../packages/shared/dist/index.js';

const jiti = createJiti(import.meta.url, {
  moduleCache: false,
  tryNative: true,
  alias: { '@earendil-works/pi-coding-agent': new URL('../vendor/pi-rp/packages/coding-agent/dist/index.js', import.meta.url).pathname },
});
const { characterGrepOperations } = await jiti.import('../extensions/toolkit/read-fence.ts');

const templateOf = (name) => fileURLToPath(new URL(`../templates/${name}`, import.meta.url));

function saveOf(template) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'truth-fence-'));
  fs.cpSync(templateOf(template), root, { recursive: true });
  return root;
}

function filesOf(root, dir = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (rel !== 'assets') out.push(...filesOf(root, rel));
    } else if (/\.(md|json|ya?ml)$/i.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Writer-only sentences in this save: every intent, every NPC persona, every ending and command body. */
function secretsOf(root) {
  const secrets = [];
  for (const rel of filesOf(root)) {
    const raw = fs.readFileSync(path.join(root, rel), 'utf8');
    if (rel.startsWith('endings/')) {
      for (const line of parseFrontmatter(raw).body.split('\n')) if (line.trim().length >= 24) secrets.push({ rel, text: line.trim() });
      continue;
    }
    if (rel.startsWith('command/')) {
      // What a command hands over (`give … body:`) is the evidence the run hides.
      for (const match of raw.matchAll(/^\s*body:\s*["']?(.{24,}?)["']?\s*$/gm)) secrets.push({ rel, text: match[1] });
      continue;
    }
    if (!rel.endsWith('.md')) continue;
    const fm = parseFrontmatter(raw).frontmatter ?? {};
    if (typeof fm.intent === 'string') secrets.push({ rel, text: fm.intent });
    if (fm.type === 'npc' && typeof fm.persona === 'string') secrets.push({ rel, text: fm.persona });
  }
  return secrets;
}

/** Every hidden state value in this save, as `<file>#<id>`. */
function hiddenValuesOf(root) {
  const values = [];
  for (const rel of filesOf(root).filter((f) => f.endsWith('.md'))) {
    const fm = parseFrontmatter(fs.readFileSync(path.join(root, rel), 'utf8')).frontmatter;
    for (const id of hiddenStateIds(fm)) values.push({ rel, id });
  }
  return values;
}

/** Assert the companion sees none of the writer's truth in `root`. Returns what it could read. */
async function assertFenced(root, companion) {
  const secrets = secretsOf(root);
  assert.ok(secrets.length > 0, 'the save has writer-only text to protect');
  const readable = [];
  for (const rel of filesOf(root)) {
    const raw = fs.readFileSync(path.join(root, rel), 'utf8');
    const text = characterViewText(rel, raw, companion);
    if (text === null) continue;
    readable.push(rel);
    if (rel.startsWith(`characters/${companion}/`)) continue; // its own mind
    for (const secret of secrets) {
      assert.ok(!text.includes(secret.text), `${companion} reads ${rel} and finds writer-only text from ${secret.rel}: ${secret.text.slice(0, 60)}…`);
    }
    if (rel.endsWith('.md')) {
      const fm = parseFrontmatter(text).frontmatter ?? {};
      for (const key of ['intent', 'persona', 'knows', 'run', 'search', 'dice_outcomes', 'on', 'choice_actions']) {
        assert.ok(!(key in fm), `${rel}: ${key} reaches ${companion}`);
      }
    }
  }
  for (const { rel, id } of hiddenValuesOf(root)) {
    const text = characterViewText(rel, fs.readFileSync(path.join(root, rel), 'utf8'), companion);
    const data = parseFrontmatter(text).frontmatter?.status?.data ?? {};
    assert.ok(!(id in data), `hidden state ${id} of ${rel} reaches ${companion}`);
  }
  for (const rel of filesOf(root)) {
    if (/^(command|endings|variants)\//.test(rel)) assert.equal(characterViewOf(rel, companion).kind, 'withheld', rel);
  }

  // One grep over the whole save for the opening words of every writer note: no match.
  const grep = characterGrepOperations(root, companion);
  const needles = secrets
    .filter((s) => !s.rel.startsWith(`characters/${companion}/`))
    .map((s) => s.text.split('\n')[0].slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const hits = await grep.search({ pattern: needles.join('|'), path: root, ignoreCase: false, literal: false, limit: 5 });
  const found = await Promise.all(hits.map(async (h) => `${path.relative(root, h.filePath)}:${h.lineNumber}: ${String(await grep.readFile(h.filePath)).split('\n')[h.lineNumber - 1]}`));
  assert.deepEqual(found, [], 'grep finds writer-only text');
  return readable;
}

function npcBriefOf(root, rel) {
  const fm = parseFrontmatter(fs.readFileSync(path.join(root, rel), 'utf8')).frontmatter;
  const npc = readNpcCard(fm);
  assert.ok(npc, `${rel} is a valid NPC card`);
  const knows = npc.knows.filter((p) => fs.existsSync(path.join(root, p))).map((p) => {
    const parsed = parseFrontmatter(fs.readFileSync(path.join(root, p), 'utf8'));
    return { path: p, title: String(parsed.frontmatter?.title ?? p), body: parsed.body };
  });
  return { npc, brief: buildNpcBrief({ path: rel, npc, frontmatter: fm, knows, history: [], line: '...', language: 'en' }) };
}

for (const edition of ['last-witness', 'last-witness-jp', 'last-witness-zh', 'last-witness-ko']) {
  for (const culprit of ['eve', 'ross', 'koharu']) {
    test(`${edition} · culprit ${culprit}: Hans reads no truth; the culprit's own brief still carries it`, { skip: skipUnlessShipped(edition) }, async () => {
      const root = saveOf(edition);
      await prepareRun(root, { force: { culprit } });
      const readable = await assertFenced(root, 'hans');
      assert.ok(readable.includes('world/eve.md') && readable.includes('world/README.md'), 'the cards themselves stay readable');
      const view = characterViewText('world/README.md', fs.readFileSync(path.join(root, 'world/README.md'), 'utf8'), 'hans');
      assert.doesNotMatch(view, /culprit|seed/);

      // The writer's view is the file: the run record and the hidden value are there.
      const raw = parseFrontmatter(fs.readFileSync(path.join(root, 'world/README.md'), 'utf8')).frontmatter;
      assert.equal(raw.status.data.culprit, culprit);
      assert.equal(raw.run.variants.culprit, culprit);

      // The culprit is voiced by the writer from its own card's brief.
      const { npc, brief } = npcBriefOf(root, `world/${culprit}.md`);
      assert.ok(brief.includes(npc.persona), 'the brief carries the persona');
      const innocent = ['eve', 'ross', 'koharu'].find((s) => s !== culprit);
      assert.ok(!brief.includes(npcBriefOf(root, `world/${innocent}.md`).npc.persona), 'and only its own');
      fs.rmSync(root, { recursive: true, force: true });
    });
  }
}

for (const truth of ['smuggler', 'fugitive', 'coverup', 'honest-mistake']) {
  test(`night-radio-zh · truth ${truth}: Nils reads no truth`, { skip: skipUnlessShipped('night-radio-zh') }, async () => {
    const root = saveOf('night-radio-zh');
    await prepareRun(root, { force: { truth } });
    await assertFenced(root, 'nils');
    const view = characterViewText('world/README.md', fs.readFileSync(path.join(root, 'world/README.md'), 'utf8'), 'nils');
    assert.ok(!(`truth` in (parseFrontmatter(view).frontmatter?.status?.data ?? {})));
    assert.equal(parseFrontmatter(fs.readFileSync(path.join(root, 'world/README.md'), 'utf8')).frontmatter.status.data.truth, truth);
    fs.rmSync(root, { recursive: true, force: true });
  });
}

for (const edition of ['forger', 'forger-jp', 'forger-zh', 'forger-ko']) {
  for (const cover of ['smith', 'dilan', 'laurent']) {
    test(`${edition} · detective ${cover}: Martel cannot learn who the detective is`, { skip: skipUnlessShipped(edition) }, async () => {
      const root = saveOf(edition);
      // The first roll of a run writes the detective here (world/README.md intent).
      const file = path.join(root, 'world/README.md');
      const parsed = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      const fm = parsed.frontmatter;
      fm.status = { ...(fm.status ?? {}), data: { ...(fm.status?.data ?? {}), cover, seed: 2 } };
      fs.writeFileSync(file, stringifyFrontmatter(fm, parsed.body));

      await assertFenced(root, 'martel');
      const view = parseFrontmatter(characterViewText('world/README.md', fs.readFileSync(file, 'utf8'), 'martel')).frontmatter;
      assert.ok(!('cover' in (view.status?.data ?? {})) && !('seed' in (view.status?.data ?? {})));
      assert.ok(!(view.states ?? []).some((s) => s.id === 'cover'));
      fs.rmSync(root, { recursive: true, force: true });
    });
  }
}
