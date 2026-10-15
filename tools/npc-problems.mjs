/**
 * NPC cards in a world directory — the part of the
 * contract that needs the disk: `npcCardErrors` checks the shape, this checks
 * that `avatar` exists and every `knows` path is either a card in the world or a
 * declared find (a search / dice reward that appears after the roll).
 *
 * Used by `check:worlds` for every template, experimental ones included.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { declaredRewardCard, npcCardErrors, parseFrontmatter } from '../packages/shared/dist/index.js';

async function walk(root, dir) {
  const out = [];
  let entries = [];
  try { entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await walk(root, rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

const exists = (file) => fs.access(file).then(() => true, () => false);

/** Every problem with the NPC cards under `root/world` and `root/player`, as `file: message` lines. */
export async function npcProblems(root) {
  const files = [...await walk(root, 'world'), ...await walk(root, 'player')];
  const cards = [];
  for (const file of files) {
    const fm = parseFrontmatter(await fs.readFile(path.join(root, file), 'utf8')).frontmatter;
    cards.push({ file, fm });
  }
  const problems = [];
  for (const { file, fm } of cards) {
    if (!fm || fm.type !== 'npc') continue;
    for (const message of npcCardErrors(fm)) problems.push(`${file}: ${message}`);
    if (!file.startsWith('world/')) problems.push(`${file}: an NPC card lives under world/`);
    if (typeof fm.avatar === 'string' && !(await exists(path.join(root, fm.avatar)))) {
      problems.push(`${file}: avatar ${fm.avatar} does not exist (omit it until the picture exists)`);
    }
    for (const known of Array.isArray(fm.knows) ? fm.knows : []) {
      if (typeof known !== 'string') continue;
      if (await exists(path.join(root, known))) continue;
      if (cards.some((card) => declaredRewardCard(card.fm, known))) continue;
      problems.push(`${file}: knows ${known}, which is neither a card in the world nor a declared find`);
    }
    if (Array.isArray(fm.dialogue) && fm.dialogue.length > 0) problems.push(`${file}: a template NPC starts with no dialogue`);
  }
  return problems;
}
