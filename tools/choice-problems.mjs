/**
 * Duplicate options on a layer: Holmes' 221B README and its
 * opening chalk declared the same two options, so the options rail listed
 * 「221B · Stop the next incident」 twice. Cards that sit on the same layer (the
 * same directory) must not declare the same option — same label, same
 * `choice_actions` target (`choiceOptionIdentity`, the rail's own rule).
 *
 * Used by `check:worlds` for every template, experimental ones included.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildInteractiveFields, choiceOptionIdentity, parseFrontmatter } from '../packages/shared/dist/index.js';

async function layers(root, dir, out = []) {
  let entries = [];
  try { entries = await fs.readdir(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  const cards = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => `${dir}/${e.name}`).sort();
  if (cards.length > 1) out.push(cards);
  for (const e of entries) if (e.isDirectory()) await layers(root, `${dir}/${e.name}`, out);
  return out;
}

const titleOf = (file, fm) => {
  const title = fm?.title ?? fm?.name;
  return typeof title === 'string' && title.trim() ? title : path.basename(file, '.md');
};

/** Every option declared by two cards on one layer, as `file: message` lines. */
export async function duplicateChoiceProblems(root) {
  const problems = [];
  for (const cards of await layers(root, 'world')) {
    const first = new Map();
    for (const file of cards) {
      const fm = parseFrontmatter(await fs.readFile(path.join(root, file), 'utf8')).frontmatter;
      if (!fm?.choice) continue;
      let options = [];
      try { options = buildInteractiveFields(fm).choice?.options ?? []; } catch { continue; }
      for (const option of options) {
        const identity = choiceOptionIdentity(fm, option, titleOf(file, fm));
        const earlier = first.get(identity);
        if (earlier && earlier !== file) problems.push(`${file}: option "${option.label}" is already declared by ${earlier} on the same layer (the options rail would list it twice)`);
        else first.set(identity, file);
      }
    }
  }
  return problems;
}
