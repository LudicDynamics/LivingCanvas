/**
 * Ambient life in a world directory — the part of the
 * contract that needs the disk. `ambientEntryProblems` (packages/shared) checks
 * one file's shape (barks ≤ 40 characters, known emotes, conditions, chats);
 * this checks that every `ambient/<id>.json` belongs to someone in the world,
 * that a chat partner and a condition's layer / card exist, and that barks
 * never vary per run (a variant overlay may not carry ambient files: a bark
 * that differs by variant would leak the run's secret).
 *
 * `official`: an official edition is one language, so a bark list is a plain
 * array (the per-locale map is for hand-made single-edition worlds); the four
 * editions carrying the same files with the same shape is asserted by
 * check-world-editions' structural comparison (`barks` is a human key there).
 *
 * Used by `check:worlds` for every template, experimental ones included.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ambientEntryProblems, parseFrontmatter } from '../packages/shared/dist/index.js';

const exists = (file) => fs.access(file).then(() => true, () => false);

async function walk(root, dir, out = []) {
  let entries = [];
  try { entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(root, rel, out);
    else out.push(rel);
  }
  return out;
}

/** Ids that can carry ambient life: `characters/<id>/` folders and NPC card stems under world/. */
export async function ambientPeople(root) {
  const ids = new Set();
  try {
    for (const entry of await fs.readdir(path.join(root, 'characters'), { withFileTypes: true })) if (entry.isDirectory()) ids.add(entry.name);
  } catch { /* no characters */ }
  for (const file of await walk(root, 'world')) {
    if (!file.endsWith('.md')) continue;
    const fm = parseFrontmatter(await fs.readFile(path.join(root, file), 'utf8')).frontmatter;
    if (fm?.type === 'npc') ids.add(path.basename(file, '.md'));
  }
  return ids;
}

/** Every problem with `root/ambient/*`, as `file: message` lines. */
export async function ambientProblems(root, { official = false } = {}) {
  const problems = [];
  for (const file of await walk(root, 'variants')) {
    if (/^variants\/[^/]+\/[^/]+\/ambient\//.test(file)) problems.push(`${file}: barks never vary per run (a variant's bark would give the run away); keep ambient/ variant-neutral in the base world`);
  }
  const files = await walk(root, 'ambient');
  if (!files.length) return problems;
  const people = await ambientPeople(root);
  for (const file of files) {
    const id = /^ambient\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/.exec(file)?.[1];
    if (!id) { problems.push(`${file}: an ambient file is ambient/<kebab-id>.json`); continue; }
    let doc;
    try { doc = JSON.parse(await fs.readFile(path.join(root, file), 'utf8')); } catch (err) { problems.push(`${file}: not JSON (${err.message})`); continue; }
    for (const message of ambientEntryProblems(doc)) problems.push(`${file}: ${message}`);
    if (!people.has(id)) problems.push(`${file}: no characters/${id}/ and no NPC card ${id}.md under world/`);
    if (!doc || typeof doc !== 'object') continue;
    const lists = [];
    if (doc.barks !== undefined) lists.push(['barks', doc.barks]);
    for (const [i, cond] of (Array.isArray(doc.when) ? doc.when : []).entries()) {
      if (cond?.barks !== undefined) lists.push([`when[${i}].barks`, cond.barks]);
      if (typeof cond?.layer === 'string' && cond.layer !== 'map' && cond.layer !== 'world' && !(await exists(path.join(root, cond.layer)))) problems.push(`${file}: when[${i}].layer ${cond.layer} is not a layer of this world`);
      if (typeof cond?.card === 'string' && !(await exists(path.join(root, cond.card)))) problems.push(`${file}: when[${i}].card ${cond.card} is not a card in this world`);
    }
    for (const [i, chat] of (Array.isArray(doc.chats) ? doc.chats : []).entries()) {
      if (chat?.barks !== undefined) lists.push([`chats[${i}].barks`, chat.barks]);
      if (typeof chat?.with === 'string') {
        if (chat.with === id) problems.push(`${file}: chats[${i}] is with ${id} itself`);
        else if (!people.has(chat.with)) problems.push(`${file}: chats[${i}].with ${chat.with} is nobody in this world`);
      }
    }
    if (official) for (const [where, value] of lists) {
      if (!Array.isArray(value)) problems.push(`${file}: ${where}: an official edition writes its own language as a plain list, not a per-locale map`);
    }
  }
  return problems;
}
