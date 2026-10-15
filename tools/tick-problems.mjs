/**
 * Authoring checks for a world's character tick,
 * run by `check:worlds` for every template.
 *
 * The runtime is fail-soft — a malformed `tick` block is ignored, a move whose
 * target is not on the player's page simply never shows, a command that fails
 * is logged and changes nothing. This gate is where those become visible, and
 * where the fairness rules are held:
 *
 *   - every move runs a `command/<run>.yaml` that exists and parses;
 *   - targets exist (a door has a README, a card is placed or a command gives it)
 *     and sit on the actor's own page — characters act only on their page;
 *   - `if` / `urgent` read declared states, `clues.*` (the triggers' key clues)
 *     or `clock.left` only;
 *   - a counter fits its target (`enter` needs a door, `take` a card);
 *   - key clues (trigger `clues:` and debrief `mysteries` paths) are never
 *     consumed, moved or deleted by a tick command, and a take / hide of one
 *     must name its recovery path (`protect`);
 *   - no direct clock / hp cost unless `tick.costs: true`, and only a trpg
 *     world may set it (§5.2);
 *   - `caps` named by moves exist.
 *
 * v2 — the people's own tick prompts:
 *   - every prompt (NPC card `tick:`, `characters/<id>/tick.md`, and each variant's copy) parses;
 *   - `prefer` / `avoid` name the actor's own moves; `may` covers the chatter moves they have;
 *   - an actor with chatter moves has a prompt;
 *   - `temper` and `voice` are word-for-word the same in every variant (a tone must not give the
 *     culprit away); in a world with run variants every prompt has `never_say`;
 *   - the words are in the edition's language;
 *   - a note's slot is never read by anything: no trigger, condition, clue list, mystery, ending or
 *     command names it (a generated note is a claim, never a way forward), and nothing places it.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseFrontmatter,
  parseStateDecls,
  parseWorldTick,
  parseTriggerCondition,
  parseWorldCommand,
  characterRefRoot,
  collectRefPaths,
  pageOfTickTarget,
  isDoorTarget,
  parseTickPromptBlock,
  parseTickPromptFile,
  resolveTickPrompt,
  tickTextInLanguage,
} from '../packages/shared/dist/index.js';
import { filesUnder } from './localize-world-editions.mjs';
import { reachablePaths } from './check-world-editions.mjs';

const exists = (p) => fs.access(p).then(() => true, () => false);

async function fmOf(file) {
  try {
    return parseFrontmatter(await fs.readFile(file, 'utf8')).frontmatter ?? {};
  } catch {
    return null;
  }
}

/** Key clue paths: every trigger `clues:` list and every debrief answer's clues. */
export function keyClues(manifest) {
  const out = new Set();
  for (const t of Array.isArray(manifest.triggers) ? manifest.triggers : []) for (const c of t?.clues ?? []) if (typeof c === 'string') out.add(c);
  for (const m of Array.isArray(manifest.mysteries) ? manifest.mysteries : []) {
    for (const o of m?.options ?? []) for (const c of o?.clues ?? []) if (typeof c === 'string') out.add(c);
  }
  return out;
}

/** A key clue named by a path, in the world or carried in the bag under the same file name. */
const touchesKey = (keys, p) => typeof p === 'string' && [...keys].some((k) => p === k || p === `player/${k.split('/').pop()}`);

/** Every problem with world.json `tick`. `[]` = clean, and for a world without one. */
export async function tickProblems(root, manifest) {
  if (manifest.tick === undefined) return [];
  const { tick, errors } = parseWorldTick(manifest.tick);
  if (!tick) return errors;
  const problems = [];
  const characterIds = (manifest.characters ?? []).map((c) => c.id);
  const declared = new Set();
  const scopes = [['player', 'player/README.md'], ['world', 'world/README.md'], ...characterIds.map((id) => [characterRefRoot(id), `characters/${id}/README.md`])];
  for (const [prefix, rel] of scopes) {
    const fm = await fmOf(path.join(root, rel));
    for (const s of fm ? parseStateDecls(fm).states : []) declared.add(`${prefix}.${s.id}`);
  }
  const keys = keyClues(manifest);
  const reachable = await reachablePaths(root);
  const caps = new Set(Object.keys(tick.caps));
  const category = manifest.intro?.category;
  if (tick.costs && category !== 'trpg') problems.push('tick.costs: only a trpg world may let a character tick cost clock or hp directly');

  const condition = async (where, expr) => {
    const parsed = parseTriggerCondition(expr, characterIds);
    if (!parsed.ok) return problems.push(`${where}: ${parsed.error}`);
    for (const ref of collectRefPaths(parsed.value)) {
      if (ref === 'clock.left') { if (!manifest.clock) problems.push(`${where}: clock.left needs world.json clock`); continue; }
      if (ref === 'clues.held' || ref === 'clues.total') { if (keys.size === 0) problems.push(`${where}: ${ref} needs triggers with clues: lists`); continue; }
      if (!declared.has(ref)) problems.push(`${where}: "${ref}" is not a declared state`);
    }
  };

  const commandSteps = new Map();
  const loadCommand = async (id) => {
    if (commandSteps.has(id)) return commandSteps.get(id);
    const file = path.join(root, 'command', `${id}.yaml`);
    let steps = null;
    if (await exists(file)) {
      const parsed = parseWorldCommand(id, await fs.readFile(file, 'utf8'));
      steps = parsed.ok ? parsed.command.steps : parsed.errors.map((e) => e.message).join('; ');
    }
    commandSteps.set(id, steps);
    return steps;
  };

  for (const [actorId, actor] of Object.entries(tick.actors)) {
    const who = `tick.actors.${actorId}`;
    let page = null;
    if (actor.card) {
      const fm = await fmOf(path.join(root, actor.card));
      if (!fm) problems.push(`${who}: card ${actor.card} does not exist`);
      else if (fm.type !== 'npc') problems.push(`${who}: card ${actor.card} is not an NPC card (type: npc)`);
      if (path.basename(actor.card, '.md') !== actorId) problems.push(`${who}: an NPC actor's id is its card's file name (${path.basename(actor.card, '.md')})`);
      page = pageOfTickTarget(actor.card);
    } else if (!characterIds.includes(actorId)) {
      problems.push(`${who}: not a world.json character and no card`);
    }
    // v2: a nudge's `suggest` names a real card option or a real place (the writer's slips it points at).
    for (const move of actor.chatter) {
      for (const sug of move.suggest ?? []) {
        const where = `${who}.moves.${move.id}.suggest`;
        if (sug.enter !== undefined) {
          if (!(await exists(path.join(root, sug.enter === 'map' ? 'world' : sug.enter, 'README.md')))) problems.push(`${where}: place ${sug.enter} has no README.md`);
          continue;
        }
        const fm = await fmOf(path.join(root, sug.card));
        const options = Array.isArray(fm?.choice?.options) ? fm.choice.options : Array.isArray(fm?.choice) ? fm.choice : [];
        if (!options.some((o) => o && typeof o === 'object' && o.id === sug.option)) problems.push(`${where}: ${sug.card} has no option "${sug.option}"`);
      }
    }
    for (const move of actor.moves) {
      const where = `${who}.moves.${move.id}`;
      // Target: on this actor's page, and real.
      if (move.target.startsWith('characters/')) {
        if (!characterIds.includes(move.target.split('/')[1])) problems.push(`${where}: target ${move.target} is not a world.json character`);
      } else if (isDoorTarget(move.target)) {
        if (!(await exists(path.join(root, move.target, 'README.md')))) problems.push(`${where}: door ${move.target} has no README.md`);
      } else if (!reachable.has(move.target)) {
        problems.push(`${where}: target ${move.target} is neither placed in the world nor given by a command`);
      }
      if (page && !move.target.startsWith('characters/') && pageOfTickTarget(move.target) !== page) {
        problems.push(`${where}: target ${move.target} is not on ${actorId}'s page (${page}) — a character acts only on its own page`);
      }
      if (move.counter.includes('enter') && !isDoorTarget(move.target)) problems.push(`${where}: counter "enter" needs a door target`);
      if (move.counter.includes('take') && (isDoorTarget(move.target) || move.target.startsWith('characters/'))) problems.push(`${where}: counter "take" needs a card target`);
      if (new Set(move.counter).size !== move.counter.length) problems.push(`${where}: counter lists a way twice`);
      if (move.cap !== undefined && !caps.has(move.cap)) problems.push(`${where}: cap "${move.cap}" is not in tick.caps`);
      if (move.if !== undefined) await condition(`${where}.if`, move.if);
      if (move.urgent !== undefined) await condition(`${where}.urgent`, move.urgent);
      // Key clues are protected (§5.1).
      if ((move.verb === 'take' || move.verb === 'hide') && touchesKey(keys, move.target) && !move.protect) {
        problems.push(`${where}: ${move.verb} of key clue ${move.target} must name its recovery path (protect)`);
      }
      // The command: exists, parses, never destroys a key clue, costs only where allowed.
      const steps = await loadCommand(move.run);
      if (steps === null) { problems.push(`${where}: run "${move.run}" — command/${move.run}.yaml does not exist`); continue; }
      if (typeof steps === 'string') { problems.push(`${where}: command/${move.run}.yaml: ${steps}`); continue; }
      steps.forEach((step, i) => {
        const at = `command/${move.run}.yaml do[${i}] ${step.action}`;
        const a = step.args ?? {};
        if (step.action === 'consume' && (a.from ?? []).some((p) => touchesKey(keys, p))) problems.push(`${at}: a character tick never consumes a key clue`);
        if (step.action === 'move' && touchesKey(keys, a.from)) problems.push(`${at}: a character tick never moves a key clue (use take / hide with protect)`);
        if ((step.action === 'edit' || step.action === 'give') && touchesKey(keys, a.path)) problems.push(`${at}: a character tick never rewrites or creates a key clue`);
        if (step.action === 'end') problems.push(`${at}: a character tick never ends the story`);
        if (step.action === 'loop_reset') problems.push(`${at}: a character tick never resets the loop`);
        const costs = step.action === 'tick' || ((step.action === 'add_state' || step.action === 'set_state') && /(^|\.)hp$/.test(String(a.state ?? '')));
        if (costs && !tick.costs) problems.push(`${at}: a direct clock / hp cost needs tick.costs: true (trpg worlds only) — make the next search cost more instead`);
      });
    }
  }
  problems.push(...(await tickPromptProblems(root, manifest, tick)));
  return problems;
}

/** The v2 checks: the people's tick prompts and the note slots. */
export async function tickPromptProblems(root, manifest, tick) {
  const problems = [];
  const locale = typeof manifest.locale === 'string' ? manifest.locale : 'en';
  const files = await filesUnder(root);
  const variantRoots = [...new Set(files.filter((f) => /^variants\/[^/]+\/[^/]+\//.test(f)).map((f) => f.split('/').slice(0, 3).join('/')))];
  const hasVariants = variantRoots.length > 0;
  const read = async (rel) => fs.readFile(path.join(root, rel), 'utf8').catch(() => null);
  for (const [actorId, actor] of Object.entries(tick.actors)) {
    const who = `tick.actors.${actorId}`;
    const rel = actor.card ?? `characters/${actorId}/tick.md`;
    const own = new Set([...actor.moves, ...actor.chatter].map((m) => m.id));
    const copies = [['', rel], ...variantRoots.map((v) => [v, `${v}/${rel}`])];
    let base = null;
    for (const [variant, file] of copies) {
      const text = await read(file);
      if (text === null) continue;
      const where = `${who} prompt (${file})`;
      const { prompt, errors } = actor.card ? parseTickPromptBlock(parseFrontmatter(text).frontmatter?.tick) : parseTickPromptFile(text);
      for (const e of errors) problems.push(`${where}: ${e}`);
      if (!prompt) continue;
      for (const id of [...(prompt.prefer ?? []), ...(prompt.avoid ?? [])]) if (!own.has(id)) problems.push(`${where}: prefer / avoid "${id}" is not one of ${actorId}'s moves`);
      const resolved = resolveTickPrompt(prompt, locale);
      const may = new Set(resolved.may);
      for (const m of actor.chatter) {
        const need = m.verb === 'speak' ? 'say' : m.verb;
        if (!may.has(need)) problems.push(`${where}: chatter move "${m.id}" (${m.verb}) needs "${need}" in may`);
      }
      if (hasVariants && resolved.neverSay.length === 0) problems.push(`${where}: a world with run variants lists never_say (this run's truth words)`);
      for (const [k, v] of [['goal', resolved.goal], ['temper', resolved.temper], ['prompt', resolved.prompt], ...resolved.voice.map((x, i) => [`voice.${i}`, x])]) {
        if (v && !tickTextInLanguage(v, locale)) problems.push(`${where}: ${k} is not in this edition's language (${locale})`);
      }
      if (variant === '') base = resolved;
      else if (base && (base.temper !== resolved.temper || JSON.stringify(base.voice) !== JSON.stringify(resolved.voice))) {
        problems.push(`${where}: temper and voice must be word-for-word the base's — a tone must not give the variant away`);
      }
    }
    if (actor.chatter.length > 0 && !base) problems.push(`${who}: has chatter moves but no tick prompt (${rel})`);
  }
  // Note slots: engine-owned paper, never a condition or a way forward.
  const slots = Object.values(tick.actors).flatMap((a) => a.chatter.filter((m) => m.slot).map((m) => m.slot));
  if (slots.length > 0) {
    const { tick: _t, ...rest } = manifest;
    const haystacks = [['world.json', JSON.stringify(rest)]];
    for (const f of files) {
      if (/(^|\/)(command|endings)\//.test(f) || (f.startsWith('world/') && f.endsWith('.md')) || f === 'hints.json') {
        const text = await read(f);
        if (text !== null) haystacks.push([f, text]);
      }
    }
    for (const slot of slots) {
      if (files.includes(slot)) problems.push(`tick note slot ${slot}: the engine writes it; nothing may place it in the world`);
      const name = slot.split('/').pop();
      for (const [f, text] of haystacks) if (text.includes(slot) || text.includes(`player/${name}`)) problems.push(`tick note slot ${slot}: named in ${f} — a generated note is a claim, never a condition, clue or item`);
    }
  }
  return problems;
}
