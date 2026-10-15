/**
 * Character tick — the engine.
 *
 * One call per player beat (`POST /api/turn-end`, and `POST /api/tick/guard`,
 * which IS a beat): read the page the player is on, resolve the pending intent
 * (counter / left the page / landed after its window), or show a new one. A
 * landed move runs its declared `command/<run>.yaml` as the ENGINE and records
 * a story event addressed to the actor; a stopped one records that too. Then
 * the world's triggers are evaluated once.
 *
 * The record is `world/README.md` frontmatter `tick` — bookkeeping like
 * `trigger_log`: no event of its own, reserved from commands and agents, and
 * inside the save, so a snapshot / rollback carries it.
 *
 * Only on the page the player is looking at: actors are the NPC cards / the
 * characters standing on that page, targets are that page's cards and doors.
 * A move's CONSEQUENCE may be state another page reads (a trace card on the
 * interrogation table makes searching the study cost more) — that is the
 * world's own commands and bindings, not this module.
 */
import type { ActionContext } from './types.js';
import type { Actor } from './actor.js';
import { reachedEnding } from './closed-world-state.js';
import { recordStoryEvent } from './story-event.js';
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { npcDialogueOf } from '../rules/npc.js';
import { parseWorldTick, tickForMode, type TickChatterMove, type TickCounter, type TickMode, type TickMove, type WorldTick } from '../schemas/tick.js';
import { parseTickPromptBlock, parseTickPromptFile, resolveTickPrompt, tickPromptPathOf, type TickPrompt } from '../schemas/tick-prompt.js';
import {
  buildTickModelRequest,
  orderTickOptions,
  parseTickModelAnswer,
  type TickModelAnswer,
  type TickModelOption,
  type TickModelPlan,
  type TickModelReply,
  type TickModelRequest,
} from '../rules/tick-model.js';
import { projectCardForCharacter } from '../rules/character-view.js';
import { createEntity } from './create.js';
import { editEntity } from './delete.js';
import {
  doorLayerOf,
  isDoorTarget,
  markTickSeen,
  pageOfTickTarget,
  planTickChatter,
  recordTickChatter,
  recordTickLine,
  tickIntentLineAllowed,
  tickMoveKey,
  type TickWords,
  parseTickState,
  serializeTickState,
  stepTickBeat,
  tickMoveAllowed,
  tickMoveOf,
  tickViewOf,
  TICK_STATE_KEY,
  EMPTY_TICK_VIEW,
  type LegalMove,
  type TickLogEntry,
  type TickPending,
  type TickState,
  type TickView,
} from '../rules/tick.js';
import { runRecordOf } from '../store/run-variants.js';
import type { WorldStore } from '../store/world-store.js';
import { collectHasPaths, evaluateCondition, type ConditionAst, type Scalar } from '../commands/condition.js';
import type { CommandTriggerHook } from '../commands/bindings.js';
import { runWorldCommand } from '../commands/execute.js';
import { parseWorldCommand } from '../commands/world-command.js';
import { withSourceLock } from '../commands/serial.js';
import {
  loadTriggerWorld,
  parseTriggerCondition,
  runWorldTriggers,
  snapshotTriggerWorld,
  type FiredTrigger,
} from '../commands/world-triggers.js';

const README = 'world/README.md';
const LOCK = 'tick';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface TickWorld {
  tick: WorldTick;
  manifest: Record<string, unknown>;
  characters: Map<string, string>;
  /** The edition's language (world.json `locale`, default en). */
  locale: string;
}

/** world.json's `tick`, straight from the file (this runs on every beat). Null: the world has none. */
export async function loadTickWorld(store: WorldStore): Promise<TickWorld | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await store.readFile('world.json'));
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.tick === undefined) return null;
  const { tick } = parseWorldTick(raw.tick);
  if (!tick) return null;
  const characters = new Map<string, string>();
  for (const c of Array.isArray(raw.characters) ? raw.characters : []) {
    if (isObj(c) && typeof c.id === 'string') characters.set(c.id, typeof c.name === 'string' ? c.name : c.id);
  }
  return { tick, manifest: raw, characters, locale: typeof raw.locale === 'string' && raw.locale ? raw.locale : 'en' };
}

async function readmeFm(store: WorldStore): Promise<{ fm: Record<string, unknown>; body: string } | null> {
  if ((await store.statKind(README)) !== 'file') return null;
  const parsed = parseFrontmatter(await store.readFile(README));
  return { fm: (parsed.frontmatter ?? {}) as Record<string, unknown>, body: parsed.body };
}

function fallbackSeed(store: WorldStore): string {
  const root = (store as { worldRoot?: unknown }).worldRoot;
  return typeof root === 'string' && root ? root.split(/[\\/]/).filter(Boolean).pop() ?? 'world' : 'world';
}

export async function readTickState(store: WorldStore, world: TickWorld): Promise<TickState> {
  const file = await readmeFm(store);
  const seed = runRecordOf(file?.fm)?.seed ?? fallbackSeed(store);
  return parseTickState(file?.fm[TICK_STATE_KEY], seed, Object.keys(world.tick.actors));
}

/** Bookkeeping write, like `trigger_log`: no event. Re-reads the file so other keys written meanwhile survive. */
async function writeTickState(store: WorldStore, state: TickState): Promise<void> {
  const file = await readmeFm(store);
  if (!file) return;
  // What was resolved this beat gets its time (the message drawer orders on it, the design notes). Only this beat's:
  // an older entry without one came from a save that predates the stamp, and "now" would be a lie for it.
  const now = new Date().toISOString();
  state.log = state.log.map((e) => (e.at || e.beat !== state.beat ? e : { ...e, at: now }));
  await store.writeFileAtomic(README, stringifyFrontmatter({ ...file.fm, [TICK_STATE_KEY]: serializeTickState(state) }, file.body));
}

// ---- reading the page --------------------------------------------------------

/** The page the player is on: what the page said, else the viewpoint, else the last entered layer, else the entry. */
export async function playerPageOf(store: WorldStore, manifest: Record<string, unknown>, hint?: string | null): Promise<string> {
  if (typeof hint === 'string' && /^(map|world\/[A-Za-z0-9_/-]+)$/.test(hint)) return hint;
  try {
    const vp = store.readViewpoint();
    if (vp?.layer) return vp.layer;
  } catch {
    // no viewpoint table
  }
  try {
    const events = await store.getEvents(200);
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i];
      if (e.type === 'layer_entered' && typeof (e.detail as { layer?: unknown }).layer === 'string') return (e.detail as { layer: string }).layer;
    }
  } catch {
    // no events yet
  }
  return typeof manifest.entry === 'string' && manifest.entry ? manifest.entry : 'map';
}

/** Where an actor stands: an NPC card's page, or a character's presence layer. */
function actorPage(store: WorldStore, world: TickWorld, id: string, exists: Map<string, boolean>): string | null {
  const actor = world.tick.actors[id];
  if (actor.card) return exists.get(actor.card) ? pageOfTickTarget(actor.card) : null;
  // Never placed yet (no presence row): the character's world.json `home`, as the companion hints read it.
  const home = (Array.isArray(world.manifest.characters) ? world.manifest.characters : []).find((c) => isObj(c) && c.id === id) as Record<string, unknown> | undefined;
  const fallback = typeof home?.home === 'string' && home.home ? home.home : null;
  try {
    const presence = store.getPresenceOf(id);
    // A companion following the player stands on whatever page the player is on.
    if (presence?.following) return FOLLOWING;
    return presence?.layer ?? fallback;
  } catch {
    return fallback;
  }
}
const FOLLOWING = '\u0000following';

async function npcFm(store: WorldStore, card: string | undefined): Promise<Record<string, unknown> | null> {
  if (!card || (await store.statKind(card)) !== 'file') return null;
  return (parseFrontmatter(await store.readFile(card)).frontmatter ?? null) as Record<string, unknown> | null;
}

/** An actor's display name: the NPC card's `name`, the character's world.json name, else the id. */
export async function tickActorNames(store: WorldStore, world: TickWorld): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [id, actor] of Object.entries(world.tick.actors)) {
    const fm = await npcFm(store, actor.card);
    const name = (typeof fm?.name === 'string' && fm.name.trim()) || world.characters.get(id) || id;
    out.set(id, name);
  }
  return out;
}

/** Player lines the actor has heard (NPC card dialogue); 0 for a registered character. */
async function talkCount(store: WorldStore, world: TickWorld, id: string): Promise<number> {
  const fm = await npcFm(store, world.tick.actors[id]?.card);
  return fm ? npcDialogueOf(fm).filter((e) => e.by === 'player').length : 0;
}

/** Every key clue the world's triggers count (`clues:` lists), for `clues.held` in a move's conditions. */
async function heldKeyClues(store: WorldStore, world: Awaited<ReturnType<typeof loadTriggerWorld>>): Promise<{ held: number; total: number }> {
  const all = new Set<string>();
  for (const t of world?.triggers ?? []) if (t.kind === 'state' && t.clues) for (const c of t.clues) all.add(c);
  let held = 0;
  for (const c of all) {
    if ((await store.statKind(c)) === 'file' || (await store.statKind(`player/${c.split('/').pop()}`)) === 'file') held += 1;
  }
  return { held, total: all.size };
}

async function targetHere(store: WorldStore, target: string, page: string): Promise<boolean> {
  if (target.startsWith('characters/')) {
    try {
      return store.getPresenceOf(target.split('/')[1])?.layer === page;
    } catch {
      return false;
    }
  }
  if (pageOfTickTarget(target) !== page) return false;
  return (await store.statKind(target.replace(/\/README\.md$/, ''))) === (isDoorTarget(target) ? 'dir' : 'file');
}

/** Moves the world allows right now on `page` (the engine's own limits are applied in `stepTickBeat`). */
async function legalMoves(ctx: ActionContext, world: TickWorld, state: TickState, page: string, present: readonly string[]): Promise<LegalMove[]> {
  if (present.length === 0) return [];
  const tw = await loadTriggerWorld(ctx.store);
  const snap = tw ? await snapshotTriggerWorld(ctx.store, tw) : null;
  const values = new Map<string, Scalar>(snap?.values ?? []);
  const clues = await heldKeyClues(ctx.store, tw);
  values.set('clues.held', clues.held);
  values.set('clues.total', clues.total);
  const characterIds = tw?.characterIds ?? [...world.characters.keys()];
  const holds = async (expr: string | undefined): Promise<boolean> => {
    if (!expr) return true;
    const parsed = parseTriggerCondition(expr, characterIds);
    if (!parsed.ok) return false;
    const paths = new Map<string, 'file' | 'dir' | 'missing'>();
    for (const p of collectHasPaths(parsed.value as ConditionAst)) paths.set(p, await ctx.store.statKind(p));
    const r = evaluateCondition(parsed.value, { values, paths });
    return r.ok && r.value;
  };
  const out: LegalMove[] = [];
  for (const id of present) {
    for (const move of world.tick.actors[id].moves) {
      if (!tickMoveAllowed(state, world.tick, id, move)) continue;
      if (!(await targetHere(ctx.store, move.target, page))) continue;
      let blocked = false;
      for (const p of move.unless ?? []) if ((await ctx.store.statKind(p)) !== 'missing') blocked = true;
      if (blocked) continue;
      if (move.if !== undefined && !(move.if.trim() && (await holds(move.if)))) continue;
      out.push({ actor: id, move, urgent: move.urgent !== undefined && (await holds(move.urgent)) });
    }
  }
  return out;
}

/** What the player did about the pending intent since it showed (events after its seq, the NPC's dialogue). */
async function counterPlayed(store: WorldStore, world: TickWorld, p: TickPending): Promise<{ counter: TickCounter | null; entered: boolean }> {
  let entered = false;
  let taken = false;
  let talked = false;
  const door = isDoorTarget(p.target) ? doorLayerOf(p.target) : null;
  try {
    for (const e of await store.getEventsSince(p.seq, { limit: 400 })) {
      const d = e.detail as Record<string, unknown>;
      if (e.actor?.type !== 'player') continue;
      if (e.type === 'layer_entered' && door && d.layer === door) entered = true;
      if (e.type === 'entity_moved' && d.from === p.target && typeof d.to === 'string' && d.to.startsWith('player/')) taken = true;
      if (e.type === 'character_talked' && d.character === p.actor) talked = true;
    }
  } catch {
    // no event table: fall through to the file reads
  }
  if (!isDoorTarget(p.target) && p.target.endsWith('.md') && (await store.statKind(p.target)) === 'missing') {
    if ((await store.statKind(`player/${p.target.split('/').pop()}`)) === 'file') taken = true;
  }
  if (!talked && (await talkCount(store, world, p.actor)) > p.talk) talked = true;
  const counter: TickCounter | null = taken ? 'take' : entered ? 'enter' : talked ? 'talk' : null;
  return { counter, entered };
}

// ---- landing ------------------------------------------------------------------

function engineCtx(ctx: ActionContext, beat: number): ActionContext {
  return { ...ctx, actor: { type: 'engine' } as Actor, turn: `tick:${beat}:${ctx.turn ?? ''}` };
}

async function runMoveCommand(ctx: ActionContext, move: TickMove, key: string): Promise<string | null> {
  const file = `command/${move.run}.yaml`;
  if ((await ctx.store.statKind(file)) !== 'file') return `${file} does not exist`;
  const parsed = parseWorldCommand(move.run, await ctx.store.readFile(file));
  if (!parsed.ok) return `${file} is malformed: ${parsed.errors.map((e) => e.message).join('; ')}`;
  const paths = new Map<string, 'file' | 'dir' | 'missing'>();
  for (const step of parsed.command.steps) {
    if (!step.whenAst) continue;
    for (const p of collectHasPaths(step.whenAst as ConditionAst)) if (!paths.has(p)) paths.set(p, await ctx.store.statKind(p));
  }
  const run = await runWorldCommand(ctx, parsed.command, {
    hook: 'trigger' as CommandTriggerHook,
    entry: 0,
    key,
    argScope: { params: {}, trigger: {} },
    conditionValues: {},
    conditionPaths: paths,
  });
  if (!run.ok) return run.error.message;
  const failed = run.result.effects.find((e) => e.settle === 'failed');
  return failed ? `${failed.at} ${failed.error?.message ?? 'failed'}` : null;
}

/** The event card for a resolved move: addressed to the actor, in the author's words. */
async function recordMoveEvent(ctx: ActionContext, world: TickWorld, entry: TickLogEntry, move: TickMove): Promise<void> {
  if (entry.result === 'void') return;
  const actor = world.tick.actors[entry.actor];
  const target = actor?.card ?? `characters/${entry.actor}`;
  const text = entry.result === 'landed' ? move.label.landed : move.label.stopped;
  try {
    await recordStoryEvent(ctx, {
      target,
      title: move.label.intent,
      text,
      tick: { actor: entry.actor, move: entry.move, verb: entry.verb, target: entry.target, result: entry.result, ...(entry.by ? { by: entry.by } : {}) },
    });
  } catch {
    // The record still says it happened; the writer reads it in `page_moves`.
  }
}

// ---- v2: the person's own words ------------------------------

/**
 * The model, as the host provides it (apps/server/src/tick-model.ts): the account's / guest's gateway or
 * an own key. `answer` returns a prefetched call with the same key when there is one, else makes a fresh
 * call; it resolves null on any failure or past its deadline — the beat then goes on by the v1 rules.
 */
export interface TickModelRunner {
  /** Whose credits pay: the per-run cap differs (registered 20, guest 8 by default). */
  tier: 'registered' | 'guest';
  answer(req: TickModelRequest): Promise<TickModelReply | null>;
}

/** The person's tick prompt in this edition's language: NPC card `tick:`, or `characters/<id>/tick.md`. */
export async function readTickPrompt(store: WorldStore, world: TickWorld, actor: string): Promise<TickPrompt | null> {
  const card = world.tick.actors[actor]?.card;
  try {
    if (card) {
      const fm = await npcFm(store, card);
      const { prompt } = parseTickPromptBlock(fm?.tick);
      return prompt ? resolveTickPrompt(prompt, world.locale) : null;
    }
    const file = tickPromptPathOf(actor);
    if ((await store.statKind(file)) !== 'file') return null;
    const { prompt } = parseTickPromptFile(await store.readFile(file));
    return prompt ? resolveTickPrompt(prompt, world.locale) : null;
  } catch {
    return null;
  }
}

const titleOf = (fm: Record<string, unknown> | null | undefined, path: string): string => {
  const t = fm?.title ?? fm?.name;
  return typeof t === 'string' && t.trim() ? t.trim() : path.split('/').pop()!.replace(/\.md$/, '');
};

async function cardsOf(store: WorldStore, dir: string): Promise<{ path: string; fm: Record<string, unknown> }[]> {
  const out: { path: string; fm: Record<string, unknown> }[] = [];
  try {
    for (const p of await store.listFiles(dir)) {
      if (!p.endsWith('.md')) continue;
      try {
        out.push({ path: p, fm: (parseFrontmatter(await store.readFile(p)).frontmatter ?? {}) as Record<string, unknown> });
      } catch {
        // unreadable card: skip
      }
    }
  } catch {
    // no such directory
  }
  return out;
}

/** Every name in the world (people, places, cards) and the people's names alone. */
async function worldNames(store: WorldStore, world: TickWorld): Promise<{ known: string[]; people: string[] }> {
  const known = new Set<string>();
  const people = new Set<string>();
  for (const name of world.characters.values()) {
    known.add(name);
    people.add(name);
  }
  for (const { path, fm } of await cardsOf(store, 'world')) {
    if (fm.type === 'chalk' || fm.tick_note) continue;
    const names = [fm.name, fm.title].filter((n): n is string => typeof n === 'string' && n.trim().length >= 2).map((n) => n.trim());
    for (const n of names) known.add(n);
    if (fm.type === 'npc') for (const n of names) people.add(n);
    // A person's given name alone (「罗斯·考尔德」 → 「罗斯」).
    if (fm.type === 'npc') for (const n of names) for (const part of n.split(/[·・ ]/)) if (part.length >= 2) people.add(part);
    void path;
  }
  return { known: [...known], people: [...people] };
}

const isCard = (fm: Record<string, unknown>) => fm.type !== 'chalk' && !fm.tick_note && fm.type !== 'npc';

/** The page as a person on it sees it: the place, who is here, the cards (projected; ≤ 600 chars). */
async function pagePicture(store: WorldStore, world: TickWorld, page: string, present: readonly string[], names: Map<string, string>): Promise<{ text: string; allowed: string[] }> {
  const dir = page === 'map' ? 'world' : page;
  const allowed: string[] = [];
  let place = '';
  if ((await store.statKind(`${dir}/README.md`)) === 'file') {
    const raw = await store.readFile(`${dir}/README.md`);
    const parsed = parseFrontmatter(projectCardForCharacter(raw));
    place = titleOf(parsed.frontmatter as Record<string, unknown> | null, dir);
    allowed.push(place);
  }
  const people = present.map((id) => names.get(id) ?? id);
  allowed.push(...people);
  const here: string[] = [];
  const doors: string[] = [];
  for (const { path, fm } of await cardsOf(store, dir)) {
    const rest = path.slice(dir.length + 1);
    if (rest === 'README.md') continue;
    if (rest.endsWith('/README.md') && rest.split('/').length === 2) {
      const t = titleOf(fm, path.replace(/\/README\.md$/, ''));
      doors.push(t);
      allowed.push(t);
      continue;
    }
    if (rest.includes('/')) continue;
    if (fm.type === 'npc') continue;
    if (!isCard(fm)) continue;
    const t = titleOf(fm, path);
    here.push(t);
    allowed.push(t);
  }
  const text = [
    place ? `Place: ${place}` : '',
    people.length ? `People here: ${people.join(', ')}` : '',
    doors.length ? `Doors: ${doors.join(', ')}` : '',
    here.length ? `On view: ${here.slice(0, 14).join(', ')}` : '',
  ].filter(Boolean).join('\n');
  return { text: text.slice(0, 600), allowed };
}

/** Engine lines about the last beats on this page (never the player's own words). */
function recentLines(state: TickState, world: TickWorld, page: string, names: Map<string, string>): string[] {
  const out: string[] = [];
  for (const e of state.log) {
    if (e.page !== page || e.result === 'void' || state.beat - e.beat > 4) continue;
    const who = names.get(e.actor) ?? e.actor;
    if (e.result === 'said') {
      const w = e.words?.say ?? e.words?.invite ?? (e.words?.note ? `(a note) ${e.words.note.body}` : '');
      if (w) out.push(`${who} said: «${w}» (a claim)`);
      continue;
    }
    const m = tickMoveOf(world.tick, e.actor, e.move);
    if (!m) continue;
    out.push(e.result === 'landed' ? `${who}: ${m.label.landed}` : `${who} tried (${m.label.intent}) and was stopped by the player`);
  }
  return out.slice(-3);
}

/** This person's own words so far this run, any page (latest last, ≤ 5): the model is told not to repeat them. */
function ownLines(state: TickState, actor: string): string[] {
  const out: string[] = [];
  for (const e of state.log) {
    if (e.actor !== actor || e.result === 'void') continue;
    const w = e.words?.say ?? e.words?.invite ?? e.words?.note?.body;
    if (w && !out.includes(w)) out.push(w);
  }
  return out.slice(-5);
}

interface PlanParts {
  names: Map<string, string>;
  world: TickWorld;
  page: string;
  present: readonly string[];
}

async function basePlan(store: WorldStore, parts: PlanParts, state: TickState, actor: string): Promise<Omit<TickModelPlan, 'kind' | 'options' | 'allow'> | null> {
  const { world, page, present, names } = parts;
  const prompt = await readTickPrompt(store, world, actor);
  if (!prompt) return null;
  const card = world.tick.actors[actor]?.card;
  let about = '';
  const knows: string[] = [];
  if (card) {
    const fm = await npcFm(store, card);
    about = typeof fm?.persona === 'string' ? fm.persona : '';
    for (const k of Array.isArray(fm?.knows) ? (fm!.knows as unknown[]) : []) {
      if (typeof k !== 'string' || (await store.statKind(k)) !== 'file') continue;
      knows.push(titleOf(parseFrontmatter(await store.readFile(k)).frontmatter as Record<string, unknown> | null, k));
    }
  } else {
    const c = (Array.isArray(world.manifest.characters) ? world.manifest.characters : []).find((x) => isObj(x) && x.id === actor) as Record<string, unknown> | undefined;
    about = typeof c?.description === 'string' ? c.description : '';
  }
  const picture = await pagePicture(store, world, page, present, names);
  const all = await worldNames(store, world);
  const name = names.get(actor) ?? actor;
  return {
    beat: state.beat,
    locale: world.locale,
    actor,
    name,
    about,
    prompt,
    page: picture.text,
    recent: recentLines(state, world, page, names),
    said: ownLines(state, actor),
    allowedNames: [...picture.allowed, ...knows, name],
    knownNames: all.known,
    peopleNames: all.people,
    deny: world.tick.deny,
  };
}

async function targetTitle(store: WorldStore, target: string | undefined, names: Map<string, string>): Promise<string> {
  if (!target) return '';
  if (target.startsWith('characters/')) return names.get(target.split('/')[1]) ?? target.split('/')[1];
  const file = isDoorTarget(target) ? `${target.replace(/\/+$/, '')}/README.md` : target;
  try {
    if ((await store.statKind(file)) !== 'file') return '';
    return titleOf(parseFrontmatter(await store.readFile(file)).frontmatter as Record<string, unknown> | null, target.replace(/\/README\.md$/, ''));
  } catch {
    return '';
  }
}

/** The intent call: the rules chose the person; the model picks among THEIR legal moves (≤ 6). */
async function intentPlan(store: WorldStore, parts: PlanParts, state: TickState, tick: WorldTick, actor: string, legal: readonly LegalMove[]): Promise<TickModelPlan | null> {
  const base = await basePlan(store, parts, state, actor);
  if (!base) return null;
  const mine = orderTickOptions(legal.filter((m) => m.actor === actor && tickMoveAllowed(state, tick, actor, m.move)).map((m) => ({ id: m.move.id, m })), base.prompt);
  if (mine.length === 0) return null;
  const options: TickModelOption[] = [];
  for (const { m } of mine) options.push({ id: m.move.id, verb: m.move.verb, about: await targetTitle(store, m.move.target, parts.names), label: m.move.label.intent });
  const sayOk = base.prompt.may.includes('say') && tickIntentLineAllowed(state, tick, actor);
  return { ...base, kind: 'intent', options, allow: { say: sayOk, note: false, invite: false } };
}

const CHATTER_LABEL: Record<string, string> = {
  speak: 'say one line, nothing else happens',
  invite: 'walk over to the player and ask for a word in private (they may ignore you)',
  note: 'leave a short signed note on the page, about yourself only',
};

async function chatterPlan(store: WorldStore, parts: PlanParts, state: TickState, actor: string, moves: readonly TickChatterMove[]): Promise<TickModelPlan | null> {
  const base = await basePlan(store, parts, state, actor);
  if (!base) return null;
  const may = new Set(base.prompt.may);
  const usable = moves.filter((m) => (m.verb === 'speak' ? may.has('say') : m.verb === 'invite' ? may.has('invite') : may.has('note')));
  const ordered = orderTickOptions(usable, base.prompt);
  if (ordered.length === 0) return null;
  const options: TickModelOption[] = [];
  for (const m of ordered) options.push({ id: m.id, verb: m.verb, about: m.verb === 'note' ? await targetTitle(store, m.slot, parts.names) : '', label: CHATTER_LABEL[m.verb] ?? m.verb });
  return {
    ...base,
    kind: 'chatter',
    options,
    allow: { say: ordered.some((m) => m.verb === 'speak'), note: ordered.some((m) => m.verb === 'note'), invite: ordered.some((m) => m.verb === 'invite') },
  };
}

/** Credits left this run for this tier. */
export function tickModelBudgetLeft(state: TickState, tick: WorldTick, tier: 'registered' | 'guest'): number {
  const cap = tier === 'guest' ? tick.modelCap.guestCredits : tick.modelCap.credits;
  return Math.max(0, cap - state.model.credits);
}

async function askModel(runner: TickModelRunner, state: TickState, plan: TickModelPlan): Promise<TickModelAnswer | null> {
  const req = buildTickModelRequest(state.seed, plan);
  let reply: TickModelReply | null = null;
  try {
    reply = await runner.answer(req);
  } catch {
    reply = null;
  }
  if (!reply) return null;
  state.model = { calls: state.model.calls + 1, credits: Math.round((state.model.credits + Math.max(0, reply.credits)) * 100) / 100 };
  return parseTickModelAnswer(reply.content, plan);
}

/** The model picked another of the same person's legal moves: show that one instead. */
function swapPendingMove(state: TickState, pending: TickPending, alt: LegalMove): void {
  const oldKey = tickMoveKey(pending.actor, pending.move);
  if ((state.used[oldKey] ?? 0) > 0) state.used[oldKey] -= 1;
  const key = tickMoveKey(pending.actor, alt.move.id);
  state.used[key] = (state.used[key] ?? 0) + 1;
  pending.move = alt.move.id;
  pending.verb = alt.move.verb;
  pending.target = alt.move.target;
  pending.id = `${pending.beat}:${key}`;
}

/** Words for a chatter beat: what the chosen move needs, or null (nothing to say → no beat). */
function chatterWords(move: TickChatterMove, words: TickWords): TickWords | null {
  const mood = words.mood ? { mood: words.mood } : {};
  if (move.verb === 'speak') return words.say ? { say: words.say, ...mood } : null;
  if (move.verb === 'invite') return words.invite ? { invite: words.invite, ...mood } : null;
  if (move.verb === 'note') return words.note ? { note: words.note, ...mood } : null;
  return null;
}

/** A note chatter: the signed note in its slot (a chalk the engine owns; never a condition, never an item). */
async function writeTickNote(ctx: ActionContext, world: TickWorld, entry: TickLogEntry, slot: string, name: string): Promise<string | null> {
  const note = entry.words?.note;
  if (!note) return null;
  const body = `${note.body}\n\n— ${name}`;
  const frontmatter = { type: 'chalk', title: note.title || name, tick_note: { by: entry.actor, claim: true } };
  try {
    if ((await ctx.store.statKind(slot)) === 'file') await editEntity(ctx, { path: slot, frontmatter, body });
    else await createEntity(ctx, { path: slot, frontmatter, body });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** The event card for a chatter beat: addressed to the person, quoting them — a claim. */
async function recordChatterEvent(ctx: ActionContext, world: TickWorld, entry: TickLogEntry, name: string): Promise<void> {
  const w = entry.words ?? {};
  const said = w.say ?? w.invite ?? w.note?.body ?? '';
  if (!said) return;
  try {
    await recordStoryEvent(ctx, {
      target: world.tick.actors[entry.actor]?.card ?? `characters/${entry.actor}`,
      title: name,
      text: `«${said}»`,
      tick: {
        actor: entry.actor,
        move: entry.move,
        verb: entry.verb,
        target: entry.target,
        result: 'said',
        claim: { ...(w.say ? { say: w.say } : {}), ...(w.invite ? { invite: w.invite } : {}), ...(w.note ? { note: w.note.body } : {}) },
      },
    });
  } catch {
    // The record keeps it; the writer reads it in `page_moves`.
  }
}

// ---- the public surface --------------------------------------------------------------

export interface TickBeatOptions {
  /** The player's per-save setting (default standard). */
  mode?: TickMode;
  /** The page the player is on, as the page reports it. */
  page?: string | null;
  /** This beat is the player guarding the pending intent with this id (`POST /api/tick/guard`). */
  guard?: string | null;
  /** v2: the model, when the host has one (null / absent → the v1 rules, silently). */
  model?: TickModelRunner | null;
  /** v2: the save's 「角色自己说话」 (default on). Off → the v1 rules, no chatter. */
  voices?: boolean;
  /**
   * v2: the companion's written hint (hints.json) speaks this beat — no character line in the same beat
   * (no chatter, no words on an intent; the intent itself still shows). Hints win when the player is stuck.
   */
  quiet?: boolean;
}

export interface TickBeatResult {
  ran: boolean;
  /** Why nothing ran: no tick, turned off, the story ended. */
  paused?: 'none' | 'off' | 'ended';
  issued?: string;
  resolved?: { id: string; result: TickLogEntry['result']; by?: TickCounter; error?: string };
  /** v2: a chatter beat happened (its log id). */
  said?: string;
  /** v2: the chatter move's written nudge (`suggest`, the same shape as a hint's): the writer's slips it points at. */
  suggest?: TickChatterMove['suggest'];
  /** v2: the person said a line this beat (a chatter line, or the words on a new intent). */
  spoke?: boolean;
  triggers: FiredTrigger[];
  view: TickView;
}

async function viewFor(store: WorldStore, world: TickWorld, state: TickState, mode: TickMode, voices = true): Promise<TickView> {
  const names = await tickActorNames(store, world);
  return { ...tickViewOf(state, world.tick, mode, (id) => names.get(id) ?? id), voices };
}

interface PreparedBeat {
  before: TickState;
  state: TickState;
  outcome: ReturnType<typeof stepTickBeat>['outcome'];
  page: string;
  present: string[];
  legal: LegalMove[];
}

/** Read the page and step the record one beat (pure step; nothing written). */
async function prepareBeat(ctx: ActionContext, world: TickWorld, tick: WorldTick, opts: TickBeatOptions): Promise<PreparedBeat> {
  const before = await readTickState(ctx.store, world);
  const page = await playerPageOf(ctx.store, world.manifest, opts.page);
  const exists = new Map<string, boolean>();
  for (const a of Object.values(tick.actors)) if (a.card) exists.set(a.card, (await ctx.store.statKind(a.card)) === 'file');
  // Only the page the player is looking at (§9 #6): an NPC card on it, or a person standing / following here.
  const present = Object.keys(tick.actors).filter((id) => {
    const at = actorPage(ctx.store, world, id, exists);
    return at === page || at === FOLLOWING;
  });
  // Intents count quiet beats only where someone with an intent could act (a companion who only chats does not).
  const intentPresent = present.filter((id) => tick.actors[id].moves.length > 0);
  const p = before.pending;
  const played = p ? await counterPlayed(ctx.store, world, p) : { counter: null, entered: false };
  // Only compute the menu when nothing is pending (it is only used then).
  const legal = p ? [] : await legalMoves(ctx, world, { ...before, beat: before.beat + 1 }, page, intentPresent);
  const talks = new Map<string, number>();
  for (const id of present) talks.set(id, await talkCount(ctx.store, world, id));
  const seq = await ctx.store.getMaxSeq().catch(() => 0);
  const { state, outcome } = stepTickBeat(before, tick, {
    page,
    actorsHere: intentPresent.length > 0,
    legal,
    counter: played.counter,
    enteredTarget: played.entered,
    guard: opts.guard ?? null,
    seq,
    talkOf: (id) => talks.get(id) ?? 0,
    moveOf: (actor, move) => tickMoveOf(tick, actor, move),
  });
  return { before, state, outcome, page, present, legal };
}

/** The model plan this beat would need (intent or chatter), or null — the same for the beat and its prefetch. */
async function modelPlanOf(ctx: ActionContext, world: TickWorld, tick: WorldTick, prep: PreparedBeat, quiet = false): Promise<{ plan: TickModelPlan; chatter?: TickChatterMove[] } | null> {
  const { state, outcome, page, present, legal } = prep;
  const names = await tickActorNames(ctx.store, world);
  const parts: PlanParts = { names, world, page, present };
  if (outcome.kind === 'issued') {
    const plan = await intentPlan(ctx.store, parts, state, tick, outcome.pending.actor, legal);
    // A hint speaks this beat: the model may still pick the move, but writes no words.
    return plan ? { plan: quiet ? { ...plan, allow: { say: false, note: false, invite: false } } : plan } : null;
  }
  if (outcome.kind !== 'none' || state.pending || quiet) return null;
  const cp = planTickChatter(state, tick, { present, movesOf: (id) => tick.actors[id]?.chatter ?? [] });
  if (!cp) return null;
  const plan = await chatterPlan(ctx.store, parts, state, cp.actor, cp.moves);
  return plan ? { plan, chatter: cp.moves } : null;
}

/**
 * The prefetch (§9.2): what the NEXT beat would ask the model, if anything — computed on the world as it
 * is now (the player's input has just arrived). Read-only. The host fires the call; the beat later takes
 * it if the key still matches.
 */
export async function planTickPrefetch(ctx: ActionContext, opts: TickBeatOptions & { tier?: 'registered' | 'guest' } = {}): Promise<TickModelRequest | null> {
  const world = await loadTickWorld(ctx.store);
  const mode = opts.mode ?? 'standard';
  if (!world || mode === 'off' || opts.voices === false) return null;
  const tick = tickForMode(world.tick, mode);
  if (await reachedEnding(ctx.store, world.manifest as never)) return null;
  const prep = await prepareBeat(ctx, world, tick, opts);
  if (tickModelBudgetLeft(prep.state, tick, opts.tier ?? 'registered') <= 0) return null;
  const planned = await modelPlanOf(ctx, world, tick, prep, opts.quiet === true);
  return planned ? buildTickModelRequest(prep.state.seed, planned.plan) : null;
}

/** One player beat. Never throws for a world without `tick`. */
export async function runTickBeat(ctx: ActionContext, opts: TickBeatOptions = {}): Promise<TickBeatResult> {
  const world = await loadTickWorld(ctx.store);
  if (!world) return { ran: false, paused: 'none', triggers: [], view: EMPTY_TICK_VIEW };
  const mode = opts.mode ?? 'standard';
  const voices = opts.voices !== false;
  if (mode === 'off') {
    return { ran: false, paused: 'off', triggers: [], view: { ...EMPTY_TICK_VIEW, wip: world.tick.wip } };
  }
  const tick = tickForMode(world.tick, mode);
  return withSourceLock(ctx.store, LOCK, async () => {
    const current = await readTickState(ctx.store, world);
    if (await reachedEnding(ctx.store, world.manifest as never)) {
      return { ran: false, paused: 'ended', triggers: [], view: await viewFor(ctx.store, world, { ...current, pending: null }, mode, voices) };
    }
    const prep = await prepareBeat(ctx, world, tick, opts);
    const { state, outcome, page, legal } = prep;

    // v2: the person's own pick and words — only when there is a model, the save has voices on and credits are left.
    const runner = voices && opts.model && tickModelBudgetLeft(state, tick, opts.model.tier) > 0 ? opts.model : null;
    let chatterEntry: TickLogEntry | null = null;
    let chatterMove: TickChatterMove | null = null;
    if (runner) {
      const planned = await modelPlanOf(ctx, world, tick, prep, opts.quiet === true).catch(() => null);
      const answer = planned ? await askModel(runner, state, planned.plan) : null;
      if (planned && answer && outcome.kind === 'issued') {
        const pending = outcome.pending;
        if (answer.move !== pending.move) {
          const alt = legal.find((m) => m.actor === pending.actor && m.move.id === answer.move);
          // Only another of the same person's legal moves (the rules' list, already filtered); else the rules' pick stays.
          if (alt) swapPendingMove(state, pending, alt);
        }
        const words: TickWords = {};
        if (answer.words.say && planned.plan.allow.say) {
          words.say = answer.words.say;
          recordTickLine(state, pending.actor);
        }
        if (answer.words.mood) words.mood = answer.words.mood;
        if (Object.keys(words).length > 0) pending.words = words;
      } else if (planned?.chatter && answer) {
        const move = planned.chatter.find((m) => m.id === answer.move) ?? null;
        const words = move ? chatterWords(move, answer.words) : null;
        if (move && words) {
          chatterMove = move;
          chatterEntry = recordTickChatter(state, planned.plan.actor, move, words, page);
        }
      }
    }

    let triggers: FiredTrigger[] = [];
    const result: TickBeatResult = { ran: true, triggers, view: EMPTY_TICK_VIEW };
    if (outcome.kind === 'issued') {
      result.issued = outcome.pending.id;
      if (outcome.pending.words?.say) result.spoke = true;
    }
    if (outcome.kind === 'resolved') {
      const { entry, move } = outcome;
      // Left the page without using its door: the move is not spent (only the budget is).
      if (entry.result === 'void') {
        const key = `${entry.actor}/${entry.move}`;
        if ((state.used[key] ?? 0) > 0) state.used[key] -= 1;
      }
      // Claim first (like trigger_log): a retried request finds it resolved and runs nothing twice.
      await writeTickState(ctx.store, state);
      if (move && entry.result === 'landed') {
        const ectx = engineCtx(ctx, state.beat);
        const error = await runMoveCommand(ectx, move, `tick:${state.seed}:${entry.id}`).catch((err: Error) => err.message);
        if (error) {
          const last = state.log[state.log.length - 1];
          if (last?.id === entry.id) last.error = error.slice(0, 300);
          await writeTickState(ctx.store, state);
        } else {
          await recordMoveEvent(ectx, world, entry, move);
        }
      } else if (move) {
        await recordMoveEvent(engineCtx(ctx, state.beat), world, entry, move);
      }
      const last = state.log[state.log.length - 1];
      result.resolved = { id: entry.id, result: entry.result, ...(entry.by ? { by: entry.by } : {}), ...(last?.id === entry.id && last.error ? { error: last.error } : {}) };
      if (entry.result !== 'void') triggers = await runWorldTriggers(ctx, { kind: 'action', action: 'tick' });
    } else {
      await writeTickState(ctx.store, state);
    }
    if (chatterEntry && chatterMove) {
      const names = await tickActorNames(ctx.store, world);
      const name = names.get(chatterEntry.actor) ?? chatterEntry.actor;
      const ectx = engineCtx(ctx, state.beat);
      if (chatterMove.verb === 'note' && chatterMove.slot) {
        const error = await writeTickNote(ectx, world, chatterEntry, chatterMove.slot, name);
        if (error) {
          const last = state.log.find((e) => e.id === chatterEntry!.id);
          if (last) last.error = error.slice(0, 300);
          await writeTickState(ctx.store, state);
        }
      }
      await recordChatterEvent(ectx, world, chatterEntry, name);
      result.said = chatterEntry.id;
      result.spoke = true;
      if (chatterMove.suggest?.length) result.suggest = chatterMove.suggest;
    }
    result.triggers = triggers;
    result.view = await viewFor(ctx.store, world, state, mode, voices);
    return result;
  });
}

/** The page drew the pending intent (`POST /api/tick/seen`). Bookkeeping only. */
export async function markTickIntentSeen(ctx: ActionContext, id: string, mode: TickMode = 'standard', voices = true): Promise<{ ok: boolean; view: TickView }> {
  const world = await loadTickWorld(ctx.store);
  if (!world || mode === 'off') return { ok: false, view: EMPTY_TICK_VIEW };
  return withSourceLock(ctx.store, LOCK, async () => {
    const state = await readTickState(ctx.store, world);
    const ok = markTickSeen(state, id);
    if (ok) await writeTickState(ctx.store, state);
    return { ok, view: await viewFor(ctx.store, world, state, mode, voices) };
  });
}

/** What the page shows now (`GET /api/tick`). */
export async function readTickView(store: WorldStore, mode: TickMode = 'standard', voices = true): Promise<TickView> {
  const world = await loadTickWorld(store);
  if (!world) return EMPTY_TICK_VIEW;
  if (mode === 'off') return { ...EMPTY_TICK_VIEW, wip: world.tick.wip };
  return viewFor(store, world, await readTickState(store, world), mode, voices);
}

// ---- what the agents read ---------------------------------------------------------

/** How many beats back the writer and an NPC still hear about a move. */
export const TICK_NOTE_BEATS = 6;
export const PAGE_MOVES_MAX_CHARS = 800;

const COUNTER_WORDS: Record<TickCounter, string> = {
  take: 'the player took it first',
  enter: 'the player went through that door first',
  guard: 'the player had it watched',
  talk: 'the player called them over to talk',
};

/** v2: the person's own words as the writer / an NPC reads them — always marked as a claim. */
function claimLine(who: string, w: TickWords | undefined): string | null {
  if (!w) return null;
  if (w.say) return `${who} said: «${w.say}» (their words — a claim, may be untrue)`;
  if (w.invite) return `${who} came over and asked the player for a word in private: «${w.invite}» (a claim)`;
  if (w.note) return `Note left by ${who}${w.note.title ? ` («${w.note.title}»)` : ''}: «${w.note.body}» (their claim, not a world fact)`;
  return null;
}

/**
 * The writer's `page_moves` lines for `layer`:
 * moves resolved on this page in the last few beats, what people said (quoted, as claims), and the
 * one showing now. Null when there is nothing to say.
 */
export async function tickPageMoves(store: WorldStore, layer: string): Promise<string | null> {
  const world = await loadTickWorld(store);
  if (!world) return null;
  const state = await readTickState(store, world);
  const names = await tickActorNames(store, world);
  const lines: string[] = [];
  let quoted = false;
  for (const e of state.log) {
    if (e.page !== layer || e.result === 'void' || state.beat - e.beat > TICK_NOTE_BEATS || e.error) continue;
    const who = names.get(e.actor) ?? e.actor;
    const claim = claimLine(who, e.words);
    if (e.result === 'said') {
      if (claim) {
        lines.push(`- ${claim}`);
        quoted = true;
      }
      continue;
    }
    const move = tickMoveOf(world.tick, e.actor, e.move);
    if (!move) continue;
    lines.push(e.result === 'landed'
      ? `- ${who}: "${move.label.landed}" (landed)`
      : `- ${who} tried: "${move.label.intent}" — stopped, ${COUNTER_WORDS[e.by ?? 'guard']}: "${move.label.stopped}"`);
    if (claim) {
      lines.push(`  ${claim}`);
      quoted = true;
    }
  }
  const p = state.pending;
  if (p && p.page === layer) {
    const move = tickMoveOf(world.tick, p.actor, p.move);
    if (move) {
      lines.push(`- Showing now, not happened yet: "${move.label.intent}". The engine resolves it; do not narrate it as done.`);
      const claim = claimLine(names.get(p.actor) ?? p.actor, p.words);
      if (claim) {
        lines.push(`  ${claim}`);
        quoted = true;
      }
    }
  }
  if (lines.length === 0) return null;
  const tail = [
    'Narrate only if it matters to the scene. Do not invent other moves, undo these, or reveal anyone\'s hidden role.',
    ...(quoted ? ['Quoted words are what that person said or wrote: claims, never truth. Never confirm or deny them on your own authority; another person may doubt them.'] : []),
  ];
  const head = 'On this page (engine facts, already happened unless marked):';
  let body = lines.join('\n');
  const room = PAGE_MOVES_MAX_CHARS - head.length - tail.join('\n').length - 2;
  if (body.length > room) body = `…${body.slice(body.length - room + 1)}`;
  return [head, body, ...tail].join('\n');
}

/**
 * For an NPC's brief: what this person just did on the page (and said, v2), or what was done to them
 * (a whisper), so a question right after gets a reaction to it.
 */
export async function tickNotesForNpc(store: WorldStore, cardPath: string): Promise<string[]> {
  const world = await loadTickWorld(store);
  if (!world) return [];
  const id = Object.entries(world.tick.actors).find(([, a]) => a.card === cardPath)?.[0] ?? null;
  const state = await readTickState(store, world);
  const names = await tickActorNames(store, world);
  const out: string[] = [];
  const said = (w: TickWords | undefined): string => {
    if (!w) return '';
    if (w.say) return ` You said: «${w.say}» — stay consistent with it, or explain it away.`;
    if (w.invite) return ` You went over and asked the player for a word in private: «${w.invite}».`;
    if (w.note) return ` You left a note: «${w.note.body}».`;
    return '';
  };
  for (const e of state.log) {
    if (e.result === 'void' || e.error || state.beat - e.beat > TICK_NOTE_BEATS) continue;
    if (e.result === 'said') {
      if (e.actor === id && e.words) out.push(`Just now, unprompted:${said(e.words)}`);
      continue;
    }
    const move = tickMoveOf(world.tick, e.actor, e.move);
    if (!move) continue;
    if (e.actor === id) {
      out.push((e.result === 'landed'
        ? `You just did this (it happened, the player may have seen it): ${move.label.landed}`
        : `You just tried this and were stopped (${COUNTER_WORDS[e.by ?? 'guard']}): ${move.label.stopped}`) + said(e.words));
    } else if (e.target === cardPath && e.result === 'landed') {
      out.push(`${names.get(e.actor) ?? e.actor} just did this to you: ${move.label.landed}`);
    }
  }
  const p = state.pending;
  if (p && p.actor === id && p.words?.say) out.push(`You are about to act (${tickMoveOf(world.tick, p.actor, p.move)?.label.intent ?? p.move}) and just said: «${p.words.say}».`);
  return out.slice(-3);
}
