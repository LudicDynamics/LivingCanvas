// Passive checks, companion specialties and the inspiration roll, world-checker side
//:
//
//   - every `passive:` list parses (place README: on enter; card: on look);
//   - its skill is on the protagonist's sheet or lent by a companion (`assist: true`), in a world with `rules`;
//   - a passive find is a DETAIL: not pre-placed in the template, not a key clue, declared once;
//   - its `when.expr` parses and never reads a hidden state (the run's truth stays the engine's);
//   - world.json `inspiration` is well formed (small fumble costs only).
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  collectRefs,
  inspirationConfigProblems,
  parseFrontmatter,
  parseHintExpr,
  parsePassive,
  parseSheet,
  parseStateDecls,
  passiveFindPaths,
  worldRulesOf,
} from '../packages/shared/dist/index.js';
import { filesUnder } from './localize-world-editions.mjs';

export async function passiveProblems(root, manifest) {
  const problems = inspirationConfigProblems(manifest).map((p) => `world.json: ${p}`);
  const files = await filesUnder(root);
  const fmOf = async (f) => parseFrontmatter(await fs.readFile(path.join(root, f), 'utf8')).frontmatter ?? {};
  const rules = worldRulesOf(manifest);
  const skills = new Set();
  if (rules) {
    if (files.includes('player/README.md')) for (const s of parseSheet(await fmOf('player/README.md'), rules.system, manifest.locale).sheet?.skills ?? []) skills.add(s.id);
    for (const c of manifest.characters ?? []) {
      const f = `characters/${c.id}/README.md`;
      if (!files.includes(f)) continue;
      for (const s of parseSheet(await fmOf(f), rules.system, manifest.locale).sheet?.skills ?? []) if (s.assist) skills.add(s.id);
    }
  }
  const keys = new Set([
    ...(manifest.triggers ?? []).flatMap((t) => t.clues ?? []),
    ...(manifest.mysteries ?? []).flatMap((m) => (m.options ?? []).flatMap((o) => o.clues ?? [])),
  ]);
  const keyNames = new Set([...keys].map((k) => k.split('/').pop()));
  const readme = files.includes('world/README.md') ? await fmOf('world/README.md') : {};
  const hidden = new Set(parseStateDecls(readme).states.filter((s) => s.hidden).map((s) => `world.${s.id}`));
  const ids = (manifest.characters ?? []).map((c) => c.id);
  const declaredFinds = new Map();
  for (const f of files.filter((x) => x.startsWith('world/') && x.endsWith('.md'))) {
    const fm = await fmOf(f);
    if (fm.passive === undefined) continue;
    const { passives, errors } = parsePassive(fm, f.endsWith('/README.md'));
    problems.push(...errors.map((e) => `${f}: ${e}`));
    if (!rules && passives.length) problems.push(`${f}: passive checks need skill rules (world.json rules)`);
    for (const p of passives) {
      const where = `${f}#${p.id}`;
      if (rules && !skills.has(p.skill)) problems.push(`${where}: skill "${p.skill}" is neither on the protagonist's sheet nor lent by a companion (assist: true)`);
      for (const find of passiveFindPaths(p)) {
        if (files.includes(find)) problems.push(`${where}: ${find} is pre-placed; a passive find exists only after its roll`);
        if (keys.has(find) || keyNames.has(find.split('/').pop())) problems.push(`${where}: ${find} is a key clue; a passive check only ever adds a detail`);
        if (declaredFinds.has(find)) problems.push(`${where}: ${find} is also declared by ${declaredFinds.get(find)}`);
        declaredFinds.set(find, where);
      }
      if (p.when?.expr) {
        const parsed = parseHintExpr(p.when.expr, ids);
        if (!parsed.ok) problems.push(`${where}: when.expr does not parse: ${parsed.error}`);
        else for (const ref of collectRefs(parsed.value)) if (hidden.has(ref)) problems.push(`${where}: reads the hidden state ${ref}`);
      }
    }
  }
  return problems;
}
