/**
 * The character's view of a world.
 *
 * A world keeps two kinds of text in the same files: what is in the world —
 * a card's title and body, its visible status and options — and what the
 * WRITER needs to run it: `intent` notes, NPC briefs, hidden states, dice
 * outcomes, commands, endings, the run record. The writer reads all of it. A
 * character agent (a companion like 「最后的证人」's Hans) is a person in the
 * world: it may read the world, but only as that person could see it. Without
 * this, `read world/eve.md` handed Hans the suspect card's raw YAML — the
 * whole truth of the run.
 *
 * This module is the ONE place that rule lives. It is pure and browser-safe;
 * the read fence (extensions/toolkit/read-fence.ts) applies it to the file
 * tools (read, grep) of every character process and of every subagent such a
 * process spawns, and `look_at` applies it to its own rendering. The writer's
 * view is never touched: nothing here runs for the writer.
 *
 * Three answers per path:
 *   - `full`      — read as is (the character's own files, assets, skills,
 *                   files outside the world's text);
 *   - `projected` — read through `projectCardForCharacter` /
 *                   `projectManifestForCharacter`;
 *   - `withheld`  — not readable at all (commands, endings, variant overlays,
 *                   engine data, other characters' private files).
 */
import { parseFrontmatter, stringifyFrontmatter } from '../schemas/frontmatter.js';
import { buildInteractiveFields, visibleChoiceOptions } from './interactive.js';

export type CharacterViewKind = 'full' | 'projected' | 'withheld';

export interface CharacterViewDecision {
  kind: CharacterViewKind;
  /** For `withheld`: one English sentence the agent can act on. */
  reason?: string;
}

/**
 * Top-level world directories a character never reads: the engine's moves
 * (`command/`), the endings (they name the truth), and the per-run overlays
 * (`variants/` — gone from every save after the draw, but present in a
 * template or draft).
 */
export const CHARACTER_WITHHELD_ROOTS: readonly string[] = ['command', 'endings', 'variants'];

/**
 * Frontmatter keys a character may see on any card. Everything else is the
 * writer's (fail closed: a new writer-facing key is hidden until it is added
 * here on purpose). Notably NOT here: `intent`, the NPC brief (`persona`,
 * `knows`, `wants`, `fears`, `gives`), `search` / `dice_outcomes` /
 * `skill_check` (the rewards and their text), `on` and `choice_actions` (what
 * an option does), `requires` / `accepts` (the solution of a lock), `run`,
 * `trigger_log`, `cg_log`, and an NPC card's `tick` prompt.
 */
export const CHARACTER_PUBLIC_KEYS: ReadonlySet<string> = new Set([
  'type', 'title', 'name', 'portable', 'preview', 'description', 'tags', 'date', 'author',
  'bg', 'bgVideo', 'ambient', 'art', 'image', 'visual', 'icon', 'caption', 'component', 'material',
  'avatar', 'avatarVideo', 'gender', 'voice', 'greeting', 'arrival_line', 'invites_follow_line', 'sheet',
  'map', 'marks', 'region', 'columns', 'rows', 'size', 'grid', 'pages', 'holds', 'target', 'blocked',
  'dialogue',
  // projected below, never copied raw
  'status', 'states', 'choice', 'roll_dice',
]);

/** `world.json` keys a character may see: what the lobby shows, nothing that runs the world. */
export const CHARACTER_PUBLIC_MANIFEST_KEYS: ReadonlySet<string> = new Set([
  'id', 'name', 'version', 'schema', 'description', 'intro', 'author', 'genre', 'tags', 'locale', 'cover', 'audio',
]);

const TEXT_CARD = /\.md$/i;

function splitPath(relPath: string): string[] {
  return relPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
}

/**
 * Pure: how `characterId` may read the world-relative `relPath`. A path that
 * climbs out of the world (`..`) is not this module's business — the read
 * fence refuses it first — so it is reported `full` here.
 */
export function characterViewOf(relPath: string, characterId: string): CharacterViewDecision {
  const parts = splitPath(relPath);
  if (parts.length === 0 || parts[0] === '..') return { kind: 'full' };
  const [top] = parts;

  // Engine data: canvas and history databases, sessions (everyone's chats),
  // snapshots (whole copies of the world). Assets are pictures.
  if (top.startsWith('.')) {
    if (top === '.airpworld' && parts[1] === 'assets') return { kind: 'full' };
    return { kind: 'withheld', reason: 'engine data is not part of the world a character can see' };
  }
  if (CHARACTER_WITHHELD_ROOTS.includes(top)) {
    return {
      kind: 'withheld',
      reason: `${top}/ is how the writer runs the story; a character only knows what happens in the scene`,
    };
  }
  if (top === 'characters' && parts.length >= 2) {
    const owner = parts[1];
    // The person's tick prompt: move ids and the run's hidden goal.
    // No character process reads it — not even its owner; what they did reaches them as events.
    if (parts.length === 3 && parts[2] === 'tick.md') {
      return { kind: 'withheld', reason: `characters/${owner}/tick.md is how the engine moves ${owner} between turns; nobody reads it in the scene` };
    }
    if (owner === characterId) return { kind: parts.length >= 3 && TEXT_CARD.test(relPath) ? 'projected' : 'full' };
    // Another character's public card is its README; the rest (memory,
    // diary, unspoken, preset) is that person's own mind.
    if (parts.length === 3 && parts[2] === 'README.md') return { kind: 'projected' };
    if (parts.length === 2) return { kind: 'full' }; // the directory listing itself
    return { kind: 'withheld', reason: `characters/${owner}/ holds ${owner}'s own memory and thoughts` };
  }
  if (parts.length === 1 && top === 'world.json') return { kind: 'projected' };
  // The companion's hint table: the writer's; a character learns a line only once it is said.
  if (parts.length === 1 && top === 'hints.json') {
    return { kind: 'withheld', reason: 'hints.json is how the writer nudges the player; you only know a hint once you have said it' };
  }
  if (TEXT_CARD.test(relPath)) return { kind: 'projected' };
  return { kind: 'full' };
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** State ids this frontmatter declares `hidden: true`. */
export function hiddenStateIds(frontmatter: Record<string, unknown> | null | undefined): Set<string> {
  const ids = new Set<string>();
  const states = frontmatter?.states;
  if (!Array.isArray(states)) return ids;
  for (const decl of states) {
    if (isRecord(decl) && decl.hidden === true && typeof decl.id === 'string') ids.add(decl.id);
  }
  return ids;
}

/**
 * Pure: the frontmatter a character sees. `own` (the character's own files)
 * keeps every key — they are that person's own notes — but hidden states are
 * hidden from their owner too (`hidden` means "never shown in any panel").
 * Returns null for null.
 */
export function projectFrontmatterForCharacter(
  frontmatter: Record<string, any> | null | undefined,
  options: { own?: boolean } = {},
): Record<string, any> | null {
  if (!frontmatter) return null;
  const hidden = hiddenStateIds(frontmatter);
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!options.own && !CHARACTER_PUBLIC_KEYS.has(key)) continue;
    out[key] = value;
  }

  if (Array.isArray(frontmatter.states)) {
    const shown = frontmatter.states.filter((decl: unknown) => !(isRecord(decl) && decl.hidden === true));
    if (shown.length > 0) out.states = shown;
    else delete out.states;
  }
  if (isRecord(frontmatter.status)) {
    const data = isRecord(frontmatter.status.data) ? frontmatter.status.data : {};
    const kept = Object.fromEntries(Object.entries(data).filter(([key]) => !hidden.has(key)));
    if (Object.keys(kept).length > 0 || frontmatter.status.label !== undefined) {
      out.status = {
        ...(frontmatter.status.label !== undefined ? { label: frontmatter.status.label } : {}),
        data: kept,
      };
    } else delete out.status;
  }
  if (frontmatter.choice !== undefined && !options.own) {
    // What the player sees: the options visible right now, by label. Their
    // `when` reads this card's status (hidden values included), so it is
    // evaluated here and never shown.
    const choice = buildInteractiveFields(frontmatter).choice;
    const visible = choice ? visibleChoiceOptions(choice) : [];
    if (visible.length > 0) {
      out.choice = {
        options: visible.map((option) => ({
          ...(option.id !== undefined ? { id: option.id } : {}),
          label: option.label,
          ...(option.hint !== undefined ? { hint: option.hint } : {}),
        })),
        ...(choice?.allowFree ? { allow_free: true } : {}),
      };
    } else delete out.choice;
  }
  if (isRecord(frontmatter.roll_dice) && !options.own) {
    const dice = frontmatter.roll_dice;
    out.roll_dice = Object.fromEntries(
      ['type', 'desc', 'expect', 'result', 'passed'].filter((key) => dice[key] !== undefined).map((key) => [key, dice[key]]),
    );
  }
  return out;
}

/**
 * Pure: a whole `.md` card as a character reads it. The body is kept as is;
 * the frontmatter goes through `projectFrontmatterForCharacter`. A block that
 * does not parse is dropped whole (fail closed — half a block could still be
 * the writer's).
 */
export function projectCardForCharacter(raw: string, options: { own?: boolean } = {}): string {
  const parsed = parseFrontmatter(raw);
  const projected = projectFrontmatterForCharacter(parsed.frontmatter, options);
  if (!projected || Object.keys(projected).length === 0) return parsed.body;
  return stringifyFrontmatter(projected, parsed.body);
}

/** Pure: `world.json` as a character reads it (lobby fields only). Unparseable → `{}`. */
export function projectManifestForCharacter(raw: string): string {
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return '{}\n';
  }
  if (!isRecord(manifest)) return '{}\n';
  const out = Object.fromEntries(Object.entries(manifest).filter(([key]) => CHARACTER_PUBLIC_MANIFEST_KEYS.has(key)));
  // The lobby card's `loop` is the run's act-by-act plan (「第三幕：钥匙打开行李车」) — a player reads it before
  // playing, but a person inside the story cannot know what comes next.
  if (isRecord(out.intro) && 'loop' in out.intro) {
    const { loop: _plan, ...intro } = out.intro;
    out.intro = intro;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * Pure: the text `characterId` reads at `relPath`, or null when the path is
 * withheld. `full` returns `raw` unchanged.
 */
export function characterViewText(relPath: string, raw: string, characterId: string): string | null {
  const decision = characterViewOf(relPath, characterId);
  if (decision.kind === 'withheld') return null;
  if (decision.kind === 'full') return raw;
  if (splitPath(relPath).join('/') === 'world.json') return projectManifestForCharacter(raw);
  const own = splitPath(relPath)[0] === 'characters' && splitPath(relPath)[1] === characterId;
  return projectCardForCharacter(raw, { own });
}
