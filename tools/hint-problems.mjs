// Option routing and companion hints, world-checker side.
//
//   - every option's `to` names a registered character, `writer`, or `companion` (only in a world that has one);
//   - hints.json parses; its speakers are characters or `writer`; what it suggests exists (a card's option, a place);
//   - a hint never reads a hidden state (`world.<id>` declared `hidden: true`) — the truth of a run stays the engine's;
//   - a hint that names a find (a search reward's / a command give's title) waits for it: its `when` reads that file.
// `kind: character` options without a `say` only warn (they still work; the label is said).
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectRefs, parseFrontmatter, parseHintExpr, parseHintTable, parseSearchDeclarations, parseStateDecls } from '../packages/shared/dist/index.js';
import { filesUnder } from './localize-world-editions.mjs';
import YAML from '../packages/shared/node_modules/yaml/dist/index.js';

const exists = (p) => fs.access(p).then(() => true, () => false);

/** Problems (errors) and warnings for one world directory. */
export async function hintProblems(root, manifest) {
  const problems = [];
  const warnings = [];
  const characters = new Set((manifest.characters ?? []).map((c) => c.id));
  const hasCompanion = (manifest.characters ?? []).some((c) => c.role === 'companion');
  const files = await filesUnder(root);
  const cards = new Map();
  for (const f of files.filter((x) => x.endsWith('.md') && (x.startsWith('world/') || x.startsWith('characters/')))) {
    const fm = parseFrontmatter(await fs.readFile(path.join(root, f), 'utf8')).frontmatter;
    if (fm) cards.set(f, fm);
  }
  const checkTo = (where, to) => {
    if (to === undefined || to === 'writer') return;
    if (to === 'companion') { if (!hasCompanion) problems.push(`${where}: to: companion, but this world has no companion`); return; }
    if (!characters.has(to)) problems.push(`${where}: to: ${to} is not a registered character`);
  };
  for (const [f, fm] of cards) {
    const options = Array.isArray(fm.choice) ? fm.choice : Array.isArray(fm.choice?.options) ? fm.choice.options : [];
    for (const o of options) {
      if (!o || typeof o !== 'object') continue;
      checkTo(`${f}#${o.id ?? o.label}`, o.to);
      const kind = o.id ? fm.choice_actions?.[o.id]?.kind : undefined;
      if (kind === 'character' && o.to === undefined && !o.say) warnings.push(`${f}#${o.id}: kind: character with no say — 「${o.label}」 stays in the left rail (a click opens the person) until it says something`);
    }
    for (const spot of parseSearchDeclarations(fm).spots) for (const band of spot.dice_outcomes ?? []) for (const o of band.options ?? []) checkTo(`${f}#${spot.id}/${o.id}`, o.to);
    for (const band of Array.isArray(fm.dice_outcomes) ? fm.dice_outcomes : []) for (const o of band?.options ?? []) checkTo(`${f}#dice/${o.id}`, o.to);
  }
  for (const r of Array.isArray(manifest.opening?.replies) ? manifest.opening.replies : []) if (r && typeof r === 'object') checkTo('world.json opening.replies', r.to);

  if (!files.includes('hints.json')) return { problems, warnings };
  const { table, errors } = parseHintTable(await fs.readFile(path.join(root, 'hints.json'), 'utf8'));
  if (!table) return { problems: [...problems, ...errors], warnings };
  const speaker = (where, by) => { if (by !== undefined && by !== 'writer' && !characters.has(by)) problems.push(`${where}: by: ${by} is not a registered character`); };
  speaker('hints.json', table.by);
  const readme = cards.get('world/README.md') ?? {};
  const hidden = new Set(parseStateDecls(readme).states.filter((s) => s.hidden).map((s) => `world.${s.id}`));
  // Finds: what a roll or a command creates, by title (the words a hint could give away).
  const finds = [];
  for (const [f, fm] of cards) {
    for (const spot of parseSearchDeclarations(fm).spots) for (const band of spot.dice_outcomes ?? []) for (const r of band.rewards ?? []) if (r.title && r.path) finds.push({ path: r.path, title: r.title });
    for (const band of Array.isArray(fm.dice_outcomes) ? fm.dice_outcomes : []) for (const r of band?.rewards ?? []) if (r?.title && r?.path) finds.push({ path: r.path, title: r.title });
    void f;
  }
  for (const f of files.filter((x) => /^command\/[^/]+\.yaml$/.test(x))) {
    const doc = YAML.parse(await fs.readFile(path.join(root, f), 'utf8')) ?? {};
    for (const step of Array.isArray(doc.do) ? doc.do : []) if (step?.action === 'give' && step.with?.path && step.with?.title) finds.push({ path: step.with.path, title: step.with.title });
  }
  const ids = [...characters];
  for (const h of table.hints) {
    const where = `hints.json ${h.id}`;
    speaker(where, h.by);
    const read = new Set([...(h.when?.has ?? []), ...(h.when?.lacks ?? [])]);
    if (h.when?.expr) {
      const parsed = parseHintExpr(h.when.expr, ids);
      if (!parsed.ok) problems.push(`${where}: when.expr does not parse: ${parsed.error}`);
      else {
        for (const ref of collectRefs(parsed.value)) if (hidden.has(ref)) problems.push(`${where}: reads the hidden state ${ref}; a hint never reads the run's hidden truth`);
        for (const m of h.when.expr.matchAll(/has\("([^"]+)"\)/g)) read.add(m[1]);
      }
    }
    for (const find of finds) {
      // The inspiration readings keep the same fence as the line itself.
      if (!find.title || ![h.say, h.inspire?.vague, h.inspire?.sharp].some((t) => t?.includes(find.title))) continue;
      const name = find.path.split('/').pop();
      if (![...read].some((p) => p === find.path || p.split('/').pop() === name)) problems.push(`${where}: names 「${find.title}」 before the player can have seen it (its when reads no ${find.path})`);
    }
    for (const s of h.suggest ?? []) {
      if (s.enter) {
        if (!(await exists(path.join(root, s.enter === 'map' ? 'world' : s.enter, 'README.md')))) problems.push(`${where}: suggests entering ${s.enter}, which is not a place`);
        continue;
      }
      const fm = cards.get(s.card);
      if (!fm) {
        // A card a roll spawns (search-<spot>.md) or resolves: its options exist only then; it must at least be on a real layer.
        if (!/\/search-[a-z0-9-]+\.md$/.test(s.card) && !finds.some((x) => x.path === s.card)) problems.push(`${where}: suggests ${s.card}, which does not exist`);
        continue;
      }
      const options = Array.isArray(fm.choice) ? fm.choice : fm.choice?.options ?? [];
      const declared = options.some((o) => o?.id === s.option) || (s.option.startsWith('collect-reward-') && Array.isArray(fm.dice_outcomes));
      if (!declared) problems.push(`${where}: ${s.card} has no option ${s.option}`);
    }
  }
  return { problems, warnings };
}
