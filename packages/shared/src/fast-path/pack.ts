/**
 * Writer fast path — the pack.
 *
 * One player beat = one model call. Everything the agent writer would have
 * `read` / `look_at`-ed is assembled here, up front:
 *
 *   - a STABLE system prefix (the fast-path contract + the world's play skill +
 *     a world digest), byte-identical every beat of a world → prefix cache;
 *   - a per-beat user message: the real `[World state]` block, active turning
 *     points, the whole current place (search bands redacted), the bag and
 *     sheet, the exits, what every declared button would do RIGHT NOW (the
 *     command engine's dry run, `previewChoice`), recent beats, the beat itself.
 *
 * Read-only: no viewpoint write, no cursor move, no event. The server's shadow
 * mode builds packs beside a live agent turn, so this must never touch the world.
 */
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import type { LocalWorldStore } from '../store/local-store.js';
import { sectionsFor } from '../render/sections.js';
import { readerOfActor } from '../actions/actor.js';
import { makeSectionDeps, collectSections, buildNextStepFacts } from '../inject/collect.js';
import { renderState } from '../render/state.js';
import { activeKeywordIntents, keywordIntentsBlock } from '../commands/world-triggers.js';
import { createActionService } from '../actions/service.js';
import { previewChoice, type ChoicePreview } from '../actions/choose.js';
import { visibleChoiceOptions } from '../rules/interactive.js';
import { layerDirOf } from '../actions/search.js';
import { layerOfDir } from '../store/layers.js';

// ——————————————————————————————————————————————————————————————————————
// 1. The stable contract (system message). Never interpolate per-beat data here.
// ——————————————————————————————————————————————————————————————————————
export const FAST_PATH_CONTRACT = `You are the Writer of an AIRP interactive story world: the world itself answering the player. This is the FAST PATH: you answer ONE player beat in ONE reply, with no tools and no second look. Everything you may rely on is in this conversation — the world's rules below, and in the user message the full current place (every card's frontmatter and text), the player's bag, who is here, the exits, the recent beats and the beat to answer. A path that is not shown is a path you have not read: never describe its contents.

[Reply format — one JSON object, keys in exactly this order]
{"route":"fast","chalk":{"append_to":null,"title":"…","text":"…","options":[]},"ops":[],"why":"…"}

route — "fast" normally. "agent" ONLY when this beat cannot be answered without work this mode cannot do: building a place or a character that does not exist yet, writing or rewiring world commands/triggers, or facts that live in files outside what you were given. With "agent": chalk null, ops [], why = what is needed (one line). Never pick "agent" because a request is odd, impossible in-world, or rude — the world answers those itself.
chalk — what the player reads now. One concise passage, 60–220 characters in the world's language, at most 3 short paragraphs. null only on a Quiet Beat with nothing to show.
  append_to — the path of a chalk card IN THE CURRENT PLACE when you continue the very same beat; null starts a new card (prefer a new card for a new beat).
  title — 2–8 characters naming the beat.
  text — prose. Write as the world, never about it. Close on something concrete. Never ask the player what they do; never write "游戏结束", "你离开了这里" as a fact the engine has not made true.
  options — 0–3 buttons on this chalk card: {"id":"kebab-id","label":"…"} (pressing it comes back to you as the player's choice) or {"id":"…","label":"…","enter":"<layer id>"} (pressing it takes the player there; ONLY a layer from [Exits]). NEVER copy an option another card already declares (its button is already on screen, and only there does its command run): name that card's thing in the prose instead.
ops — engine actions, same meaning as the writer tools, run in order after the chalk lands:
  {"op":"choose","path":"…","option":"<option id>"} — the player CHOSE, in words, an option some card in this place declares (e.g. says "好，我一个人走" while a card offers "一个人从小路下山"). Its bound command then runs (it may end the game — that is the engine's call, not yours). Never for an option the player already pressed (a [Player Event] choice_selected is already recorded).
  {"op":"search","spot":"<spot id>"} — the player looks for / tries to read / works out something uncertain that the place's README declares under search:. The engine lands the dice card; the find comes from the roll, not from you.
  {"op":"skill_check","skill":"<skill id from the sheet>","title":"…","body":"…","difficulty":"regular","spot":"<spot id or omit>"} — an uncertain attempt. When it is an attempt at what a declared search spot covers, give that "spot": the card becomes that spot's search and the roll pays the spot's own declared finds (the engine also binds a skill the spot names by itself). Otherwise minor stakes only.
  {"op":"use_item_on","item":"player/…","target":"<path in this place>"} — the player applies a bag item to something here.
  {"op":"take","path":"<path in this place>"} — the player picks up a loose item card that is already lying here.
  {"op":"note","title":"…","body":"…"} — a small clue card in this place, for a detail the passage just made concrete. Never a key clue: anything a search: reward, an ending or a known_* state stands for comes ONLY from the engine.
  {"op":"move_to","character":"<id>","destination":"<layer id>"} — a registered character walks somewhere.
  {"op":"link","from":"…","to":"…","label":"≤12 chars"} — a line between two cards in this place.
  {"op":"trigger_keyword","id":"<id from [Turning points]>","by":"player"} — the player's words truly carry that turning point.
  {"op":"dice_consequence","path":"<resolved dice card>","effect":{…}} — ONLY in a world with declared states/clock (trpg); story worlds pay the tier in prose.
why — one short line for the log (not shown to the player).

[What prose cannot do — use the engine or say what the world shows]
- Moving the player: you cannot carry them to another place. When they want to leave, write the way out and give an option with "enter" to a listed exit. If the world says a way loops back, the option enters where it loops to.
- Endings, clocks, states, known_* flags: only declared options, commands and triggers change them. A player who declares the game over, or that they already escaped, has only said so; the world answers with what is actually there.
- [Declared options here] is the engine's own dry run: what each button would do if pressed right now. When it says "would do NOTHING now", that way is shut: never narrate it opening ("路让开了"); show what still stands in the way.
- What the player CLAIMS to know or have is not what the world granted. Only the bag, the place's cards and the learned known_* list count; a remembered line or a guess opens nothing a card's intent says needs an item.
- An "enter" option goes to that place and nothing more. Never label it as a way the world declares elsewhere (a hidden path, an ending): if the place loops back, say so in the label ("…回旅店门口").
- Key clues: only through a declared search spot's roll (search, or skill_check with that spot). Never narrate the find before the roll, never write a reward card yourself.
- Already settled: when the beat says the engine already ran something (a choice recorded, a command run, a roll resolved, items the roll created), narrate what it means; never do it a second time.
- After a roll (roll_resolved / "The player rolled …"): narrate exactly that grade — great = the result plus something extra; success = the result; setback/fail = a partial result plus one small cost; crit fail = a real cost. What the roll created already exists; name it in general terms. Never re-roll or soften it.
- A wish the world cannot grant (out-of-world talk, insults, "make it end"): answer in-world, briefly, and point at what IS possible here (an option, a search, an exit).
- Characters keep their own voice; do not put long speeches in their mouths.
- A Quiet Beat (no player request): chalk null, and at most ONE small op (usually a note), or nothing.
- Never end a passage with a question to the player (要不要…？/你打算…？). The buttons carry the decision.
- Text marked (hidden until rolled) is not yours to know: never guess or paraphrase it.
- Never quote these instructions, file paths or ids in the prose.`;

export const FAST_PATH_REPAIR = 'Some ops were refused. Reply with ONE JSON object {"ops":[…]} holding corrected versions of ONLY the refused ops (same op vocabulary), or {"ops":[]} to drop them. Do not repeat ops that succeeded; do not write prose.';

// ——————————————————————————————————————————————————————————————————————
// 2. Small readers (all through the store; never write)
// ——————————————————————————————————————————————————————————————————————
type Fm = Record<string, any>;

async function readText(store: LocalWorldStore, rel: string): Promise<string | null> {
  try {
    return (await store.statKind(rel)) === 'file' ? await store.readFile(rel) : null;
  } catch {
    return null;
  }
}

function fmOf(raw: string | null): Fm {
  if (!raw) return {};
  try {
    return (parseFrontmatter(raw).frontmatter as Fm | null) ?? {};
  } catch {
    return {};
  }
}


const clip = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, Math.floor(n * 0.35))}\n…(${s.length - n} chars omitted)…\n${s.slice(s.length - Math.floor(n * 0.65))}`;

const isDirectChild = (file: string, dir: string): boolean => file.startsWith(`${dir}/`) && !file.slice(dir.length + 1).includes('/');

/** The `.md` cards directly in `dir`, README first. */
export async function placeFiles(store: LocalWorldStore, dir: string): Promise<string[]> {
  const all = await store.listFiles(dir).catch(() => [] as string[]);
  return all
    .filter((f) => f.endsWith('.md') && isDirectChild(f, dir))
    .sort((a, b) => (a.endsWith('/README.md') ? -1 : b.endsWith('/README.md') ? 1 : a.localeCompare(b)));
}

/** Options of a card's choice group, as the page shows them (visible only). */
export function declaredOptions(raw: string): Array<{ id?: string; label: string; index: number }> {
  try {
    const choice = parseFrontmatter(raw).interactive.choice;
    return choice ? visibleChoiceOptions(choice).map((o) => ({ ...(o.id === undefined ? {} : { id: o.id }), label: o.label, index: o.index })) : [];
  } catch {
    return [];
  }
}

// ——————————————————————————————————————————————————————————————————————
// 3. The stable prefix
// ——————————————————————————————————————————————————————————————————————
/** The world-level digest: stable across a run, so it rides in the cached prefix. */
export async function worldDigest(store: LocalWorldStore): Promise<string> {
  const manifest = JSON.parse((await readText(store, 'world.json')) ?? '{}') as Fm;
  const lines = [`[World] ${manifest.name ?? ''} · locale ${manifest.locale ?? 'en'} · mode ${manifest.mode ?? 'open'} · category ${manifest.intro?.category ?? '?'} · rules ${manifest.rules?.system ?? 'none'}`];
  const states = fmOf(await readText(store, 'world/README.md')).states;
  if (Array.isArray(states) && states.length > 0) lines.push('(world declares states — but only commands change them)');
  lines.push('[Endings] ' + (Array.isArray(manifest.endings) ? manifest.endings : []).map((e: Fm) => `${e.id} 「${e.title}」`).join(' · '));
  lines.push('[Triggers — the engine fires these, never you]');
  for (const t of Array.isArray(manifest.triggers) ? manifest.triggers : []) {
    const when = typeof t.when === 'string' ? t.when : t.when?.intent ? `intent: ${t.when.intent}` : JSON.stringify(t.when);
    lines.push(`- ${t.id} (${t.kind}) ${t.label ?? ''} — when ${when} → ${t.do ? `command ${t.do}` : t.ending ? `ending ${t.ending}` : '?'}`);
  }
  lines.push('[Commands]');
  const commands = (await store.listFiles('command').catch(() => [] as string[])).filter((f) => /^command\/[^/]+\.yaml$/.test(f)).sort();
  for (const f of commands) {
    const raw = (await readText(store, f)) ?? '';
    const name = /^name:\s*(.+)$/m.exec(raw)?.[1] ?? '';
    const desc = /^desc:\s*(.+)$/m.exec(raw)?.[1] ?? '';
    lines.push(`- ${f.replace(/^command\//, '').replace(/\.yaml$/, '')}: ${name}${desc ? ` — ${desc}` : ''}`);
  }
  return lines.filter(Boolean).join('\n');
}

/** World play skills (`skills/<world>-play/SKILL.md`), whole and without frontmatter. */
export async function worldSkills(store: LocalWorldStore): Promise<string> {
  const files = (await store.listFiles('skills').catch(() => [] as string[])).filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f)).sort();
  const out: string[] = [];
  for (const f of files) {
    const raw = await readText(store, f);
    if (raw) out.push(raw.replace(/^---[\s\S]*?---\n/, ''));
  }
  return out.join('\n\n');
}

export async function fastPathSystem(store: LocalWorldStore): Promise<string> {
  return [FAST_PATH_CONTRACT, '# World rules (the world skill)', await worldSkills(store), '# World digest', await worldDigest(store)].join('\n\n');
}

// ——————————————————————————————————————————————————————————————————————
// 4. The per-beat tail
// ——————————————————————————————————————————————————————————————————————
/** Where the player can go from here: the parent, child places with a README, declared `enter` targets. */
export async function exitsOf(store: LocalWorldStore, layer: string): Promise<Map<string, string>> {
  const dir = layerDirOf(layer);
  const out = new Map<string, string>();
  const nameOf = async (d: string) => {
    const fm = fmOf(await readText(store, `${d}/README.md`));
    return String(fm.name ?? fm.title ?? d);
  };
  if (dir !== 'world') {
    const parent = dir.slice(0, dir.lastIndexOf('/')) || 'world';
    out.set(layerOfDir(parent), `${await nameOf(parent)} (back out)`);
  }
  const dirs = (await store.listDirs(dir).catch(() => [] as string[])).filter((d) => isDirectChild(d, dir));
  for (const d of dirs.sort()) {
    if ((await store.statKind(`${d}/README.md`)) === 'file') out.set(d, await nameOf(d));
  }
  for (const f of await placeFiles(store, dir)) {
    const fm = fmOf(await readText(store, f));
    const acts = [
      ...Object.values((fm.choice_actions ?? {}) as Record<string, Fm>),
      ...((Array.isArray(fm.choice?.options) ? fm.choice.options : []) as Fm[]).map((o) => o?.action).filter(Boolean),
    ] as Fm[];
    for (const a of acts) {
      if (a?.kind === 'enter' && typeof a.target === 'string' && !out.has(a.target)) {
        out.set(a.target, `${a.target === 'map' ? await nameOf('world') : await nameOf(layerDirOf(a.target))} (declared on ${f})`);
      }
    }
  }
  return out;
}

/**
 * A declared search's per-band contents are the world's key clues. The fast
 * path does not even get them, so it cannot leak them into prose before the
 * roll; the roll (the engine) creates them.
 */
export function redactCard(raw: string): string {
  if (!raw.includes('dice_outcomes')) return raw;
  try {
    const { frontmatter, body } = parseFrontmatter(raw);
    if (!frontmatter) return raw;
    const hide = (spot: Fm) => (spot && Array.isArray(spot.dice_outcomes)
      ? { ...spot, dice_outcomes: `(${spot.dice_outcomes.length} bands declared — what each finds is hidden until rolled)` }
      : spot);
    const next: Fm = { ...frontmatter };
    if (Array.isArray(next.search)) next.search = next.search.map(hide);
    if (next.dice_outcomes) next.dice_outcomes = hide(next).dice_outcomes;
    return stringifyFrontmatter(next, body);
  } catch {
    return raw;
  }
}

const argText = (args: unknown): string => {
  if (args === undefined || args === null) return '';
  if (typeof args !== 'object') return ` ${String(args)}`;
  const pairs = Object.entries(args as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object');
  return pairs.length ? ` ${pairs.map(([k, v]) => `${k}=${String(v)}`).join(' ')}` : '';
};

/** One line per button: the dry run's verdict in words the model reads. */
export function previewLine(file: string, p: ChoicePreview): string {
  const head = `- ${file} · 「${p.option.label}」${p.option.id ? ` (id ${p.option.id})` : ''}`;
  if (p.verdict === 'client') {
    const c = p.client ?? {};
    return `${head} → ${String(c.kind)}${c.target ? ` ${String(c.target)}` : ''}${c.spot ? ` spot ${String(c.spot)}` : ''} (page action, always)`;
  }
  if (p.verdict === 'writer') return `${head} → comes back to the writer as the player's choice`;
  const cmds = (p.commands ?? []).map((c) => {
    if (c.status === 'ok') {
      const eff = (c.effects ?? []).map((e) => `${e.action}${argText((e as { args?: unknown }).args)}`).join(' + ');
      return `command ${c.command}: ${eff || 'every effect’s when is false'}`;
    }
    if (c.status === 'skipped') return `command ${c.command}: ${c.skipped === 'already_done' ? 'already done' : 'binding not matched'}`;
    return `command ${c.command || '?'}: refused (${c.message ?? c.code})`;
  }).filter((s) => !/binding not matched$/.test(s));
  const verdict = { would_run: 'would run', nothing: 'would do NOTHING now', already_done: 'already done — pressing again changes nothing', error: 'would be refused by the engine' }[p.verdict];
  return `${head} → ${cmds.join('; ') || 'no binding matches'} → ${verdict}`;
}

/**
 * A read view of the store for one pack: the layer scan and the manifest are
 * read once, not once per button (each `previewChoice` resolves its card's
 * layer, and `resolveLayer` walks the world tree). Every other member is the
 * store's own, bound to it. Only for read-only work.
 */
function memoReads(store: LocalWorldStore): LocalWorldStore {
  const layers = new Map<string, Promise<string | null>>();
  let manifest: ReturnType<LocalWorldStore['getManifest']> | null = null;
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'resolveLayer') {
        return (rel: string) => {
          if (!layers.has(rel)) layers.set(rel, target.resolveLayer(rel));
          return layers.get(rel)!;
        };
      }
      if (prop === 'getManifest') return () => (manifest ??= target.getManifest());
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** What every declared option in this place would do if pressed NOW (dry run, nothing written). */
export async function optionPreviews(store: LocalWorldStore, dir: string): Promise<{ lines: string[]; previews: Array<{ path: string; preview: ChoicePreview }> }> {
  const svc = createActionService(memoReads(store), { type: 'player' }, { turn: `fast-path-preview:${Date.now()}` });
  const lines: string[] = [];
  const previews: Array<{ path: string; preview: ChoicePreview }> = [];
  for (const f of await placeFiles(store, dir)) {
    const raw = await readText(store, f);
    if (!raw) continue;
    for (const o of declaredOptions(raw)) {
      try {
        const preview = await previewChoice(svc.ctx, { path: f, choice: o.id ?? o.index });
        previews.push({ path: f, preview });
        lines.push(previewLine(f, preview));
      } catch (err) {
        lines.push(`- ${f} · 「${o.label}」 → cannot be pressed now (${(err as Error).message})`);
      }
    }
  }
  return { lines, previews };
}

async function recentBeats(store: LocalWorldStore, n = 8): Promise<string> {
  try {
    const rows = [...(await store.getEvents(n))].sort((a, b) => Number(a.seq) - Number(b.seq));
    if (!rows.length) return '(none)';
    return rows.map((r) => {
      const d = (r.detail ?? {}) as Fm;
      const what = d.choice ? `chose 「${d.choice}」` : d.result !== undefined ? `rolled ${d.result} → ${d.outcome ?? ''}` : d.summary?.text ?? d.summary ?? d.name ?? '';
      const actor = (r.actor as { type?: string } | undefined)?.type ?? '';
      return `- #${r.seq} ${actor} ${r.type} ${r.subject ?? ''} ${String(what).slice(0, 140)}`;
    }).join('\n');
  } catch {
    return '(none)';
  }
}

export interface FastPathPack {
  system: string;
  user: string;
  layer: string;
  dir: string;
  exits: Map<string, string>;
  triggerIds: string[];
  quiet: boolean;
  /** The dry run of every declared option (logged; the validator reads it). */
  previews: Array<{ path: string; preview: ChoicePreview }>;
  buildMs: number;
}

/**
 * Everything the writer would have read for this beat. The current place is
 * clipped per card (long chalk keeps head + tail). `request` is the server's
 * own beat text (`[Player Request]` / `[Player Event]` / `[Quiet Beat]`).
 */
export async function buildFastPathPack(store: LocalWorldStore, input: { layer: string; request: string }): Promise<FastPathPack> {
  const t0 = performance.now();
  const { layer, request } = input;
  const dir = layerDirOf(layer);
  // Every part is a read of its own: run them side by side (the pack sits before the first character).
  const stateP = (async () => {
    try {
      const actor = { type: 'writer' as const };
      const specs = sectionsFor(actor);
      const deps = await makeSectionDeps({ store, actor, reader: readerOfActor(actor), specs });
      const collected = await collectSections({ ...deps, specs });
      return renderState(collected, await buildNextStepFacts(deps, collected));
    } catch {
      return '[World state] (unavailable)';
    }
  })();
  const cards = async (d: string, readmeMax: number, cardMax: number, redact: boolean) =>
    Promise.all((await placeFiles(store, d)).map(async (f) => {
      const raw = ((await readText(store, f)) ?? '').trim();
      return `### ${f}\n${clip(redact ? redactCard(raw) : raw, f.endsWith('README.md') ? readmeMax : cardMax)}`;
    }));
  const [stateBlock, active, place, bag, exits, preview, beats, system] = await Promise.all([
    stateP,
    activeKeywordIntents(store).catch(() => []),
    cards(dir, 6000, 1600, true),
    cards('player', 2400, 900, false),
    exitsOf(store, layer),
    optionPreviews(store, dir),
    recentBeats(store),
    fastPathSystem(store),
  ]);
  const triggerIds = active.map((k) => k.id);
  const intents = active.length ? keywordIntentsBlock(active) ?? '' : '';
  const user = [
    stateBlock,
    intents ? `[Turning points you may fire with trigger_keyword]\n${intents}` : '[Turning points] (none active here)',
    `[Current place: ${layer}] every card, frontmatter included`,
    place.join('\n\n') || '(empty)',
    '[Player bag and sheet]',
    bag.join('\n\n') || '(empty)',
    `[Exits from ${layer}]\n${[...exits].map(([id, name]) => `- ${id} — ${name}`).join('\n') || '(none)'}`,
    `[Declared options here — the engine's dry run: what pressing each would do right now]\n${preview.lines.join('\n') || '(none)'}`,
    `[Recent beats, oldest first]\n${beats}`,
    `[This beat]\n${request}`,
    'Answer with the JSON object now.',
  ].join('\n\n');
  return {
    system,
    user,
    layer,
    dir,
    exits,
    triggerIds,
    quiet: request.includes('[Quiet Beat]'),
    previews: preview.previews,
    buildMs: performance.now() - t0,
  };
}
