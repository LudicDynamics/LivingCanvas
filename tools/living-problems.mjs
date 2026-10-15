/**
 * Authoring checks for a living world, run by
 * `check:worlds` for every template. The runtime is fail-soft (a malformed
 * `living` block is ignored, a missing place keeps a resident where they are,
 * a missing picture keeps the old one); this gate is where those become visible.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseFrontmatter,
  parseLivingWorld,
  parseStateDecls,
  parseTriggerCondition,
  parseWorldCommand,
  characterRefRoot,
  collectRefPaths,
  livingRefProblem,
} from '../packages/shared/dist/index.js';

const exists = (p) => fs.access(p).then(() => true, () => false);
const readmeOf = (root, layer) => path.join(root, layer === 'map' ? 'world' : layer, 'README.md');

async function fmOf(file) {
  try {
    return parseFrontmatter(await fs.readFile(file, 'utf8')).frontmatter ?? {};
  } catch {
    return null;
  }
}

/** Command ids that use `pass_time` (only a living world has a clock to pass). */
async function passTimeCommands(root) {
  const dir = path.join(root, 'command');
  const out = [];
  for (const f of (await fs.readdir(dir).catch(() => [])).filter((x) => x.endsWith('.yaml')).sort()) {
    const parsed = parseWorldCommand(f.slice(0, -5), await fs.readFile(path.join(dir, f), 'utf8'));
    if (parsed.ok && parsed.command.steps.some((s) => s.action === 'pass_time')) out.push(f);
  }
  return out;
}

/** Every problem with world.json `living`. `[]` = clean (and for a world without one that uses no pass_time). */
export async function livingProblems(root, manifest) {
  const problems = [];
  if (manifest.living === undefined) {
    for (const f of await passTimeCommands(root)) problems.push(`command/${f}: pass_time needs world.json living`);
    return problems;
  }
  const { living, errors } = parseLivingWorld(manifest.living);
  if (!living) return errors;
  const characters = new Map((manifest.characters ?? []).map((c) => [c.id, c]));
  const characterIds = [...characters.keys()];

  // Declared states every `if:` may read (the trigger layer's names).
  const declared = new Set();
  const statesOf = async (prefix, rel) => {
    const fm = await fmOf(path.join(root, rel));
    const list = fm ? parseStateDecls(fm).states : [];
    for (const s of list) declared.add(`${prefix}.${s.id}`);
    return list;
  };
  await statesOf('player', 'player/README.md');
  await statesOf('world', 'world/README.md');
  const characterStates = new Map();
  for (const id of characterIds) characterStates.set(id, await statesOf(characterRefRoot(id), `characters/${id}/README.md`));

  const layer = async (where, l) => { if (!(await exists(readmeOf(root, l)))) problems.push(`${where}: layer ${l} does not exist`); };
  const condition = (where, expr) => {
    const parsed = parseTriggerCondition(expr, characterIds);
    if (!parsed.ok) { problems.push(`${where}: if: ${parsed.error}`); return; }
    for (const ref of collectRefPaths(parsed.value)) {
      if (ref.startsWith('time.') || ref.startsWith('events.')) { const p = livingRefProblem(manifest.living, ref); if (p) problems.push(`${where}: ${p}`); continue; }
      if (ref === 'clock.left' || ref.startsWith('clues.')) { problems.push(`${where}: "${ref}" cannot be read in a living if:`); continue; }
      if (!declared.has(ref)) problems.push(`${where}: "${ref}" is not a declared state`);
    }
  };

  for (const [id, resident] of Object.entries(living.residents ?? {})) {
    const where = `living.residents.${id}`;
    if (!characters.has(id)) { problems.push(`${where}: no character "${id}" in world.json characters`); continue; }
    for (const [i, entry] of resident.schedule.entries()) {
      await layer(`${where}.schedule[${i}]`, entry.at);
      if (entry.if) condition(`${where}.schedule[${i}]`, entry.if);
    }
    const states = characterStates.get(id) ?? [];
    for (const [i, rule] of (resident.daily ?? []).entries()) {
      const decl = states.find((s) => s.id === rule.state);
      if (!decl) { problems.push(`${where}.daily[${i}]: characters/${id}/README.md declares no state "${rule.state}"`); continue; }
      if (rule.pick) for (const v of Object.keys(rule.pick)) if (decl.type !== 'enum' || !(decl.values ?? []).includes(v)) problems.push(`${where}.daily[${i}]: "${v}" is not a value of ${rule.state}`);
      if (rule.by !== undefined && decl.type !== 'number') problems.push(`${where}.daily[${i}]: by needs a number state`);
    }
  }
  for (const [i, e] of (living.events ?? []).entries()) {
    if (e.at) await layer(`living.events[${i}]`, e.at);
    if (Array.isArray(e.gather)) for (const g of e.gather) if (!living.residents?.[g]) problems.push(`living.events[${i}]: gather "${g}" is not a resident`);
  }
  for (const [l, v] of Object.entries(living.variants ?? {})) {
    const where = `living.variants.${l}`;
    await layer(where, l);
    const fm = await fmOf(readmeOf(root, l));
    if (fm && fm.bg !== v.base) problems.push(`${where}: base ${v.base} is not the layer's bg (${fm.bg ?? 'none'})`);
    for (const pic of [v.base, ...v.when.map((w) => w.bg)]) if (!(await exists(path.join(root, pic)))) problems.push(`${where}: picture ${pic} is missing`);
    for (const [i, w] of v.when.entries()) if (w.if) condition(`${where}.when[${i}]`, w.if);
  }
  return problems;
}
