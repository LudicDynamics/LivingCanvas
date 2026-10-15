/**
 * Passive checks — the declarations.
 *
 * A place README (rolled on entering it) or a card (rolled when the player reads
 * it through a declared option) may list `passive:` checks. The engine rolls
 * them in the dark with the best number among the player and the companions
 * with the player who lend that skill (`assist: true`); a success leaves one
 * more detail — a line, a card, or both. A failure leaves nothing, a fumble
 * costs nothing, and the player is never told a roll happened. Each check is
 * tried once per loop.
 *
 *   passive:
 *     - id: breath                 # unique in this file
 *       skill: listen              # a sheet skill id
 *       difficulty: hard           # optional (coc regular / hard / extreme; dnd a DC)
 *       on: enter                  # README default; a card's default is look
 *       when: { lacks: [player/pill-strip.md] }   # optional: has / lacks / expr
 *       say: 他的呼吸太匀了，不像睡着的人。          # the line on a success
 *       find: { path: world/sleeper/breath.md, title: …, body: …, portable: false }
 *       great: { say: …, find: { … } }           # optional: what a critical adds
 *
 * A passive find is a DETAIL: never a key clue (check:worlds), never pre-placed,
 * so the ending never depends on a hidden roll.
 *
 * Pure, browser-safe. `actions/passive.ts` reads the world and rolls.
 */
import { SKILL_ID_RE } from './skills.js';

export const PASSIVE_LOG_KEY = 'passive_log';
export const PASSIVE_SAY_MAX = 200;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FIND_RE = /^world\/[A-Za-z0-9_/-]+\.md$/;
const PATH_RE = /^(world|player|characters)\/[A-Za-z0-9_/.-]+$/;

export type PassiveTrigger = 'enter' | 'look';

export interface PassiveFind {
  path: string;
  title: string;
  body: string;
  portable: boolean;
}

export interface PassiveReward {
  say?: string;
  find?: PassiveFind;
}

export interface PassiveDecl extends PassiveReward {
  id: string;
  skill: string;
  difficulty?: string | number;
  on: PassiveTrigger;
  when?: { has?: string[]; lacks?: string[]; expr?: string };
  great?: PassiveReward;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;

function rewardOf(raw: Record<string, unknown>, where: string, errors: string[]): PassiveReward {
  const out: PassiveReward = {};
  if (raw.say !== undefined) {
    if (text(raw.say, PASSIVE_SAY_MAX)) out.say = raw.say.trim();
    else errors.push(`${where}.say must be one line of at most ${PASSIVE_SAY_MAX} characters`);
  }
  if (raw.find !== undefined) {
    const f = raw.find;
    if (!isObj(f) || typeof f.path !== 'string' || !FIND_RE.test(f.path) || /\/README\.md$/.test(f.path) || f.path.includes('..')) {
      errors.push(`${where}.find.path must be a world/…/*.md card path (not a README)`);
    } else if (!text(f.title, 200) || typeof f.body !== 'string' || f.body.length > 4000) {
      errors.push(`${where}.find needs a title and a body`);
    } else if (f.portable !== undefined && typeof f.portable !== 'boolean') {
      errors.push(`${where}.find.portable is true or false`);
    } else {
      out.find = { path: f.path, title: f.title.trim(), body: f.body, portable: f.portable !== false };
    }
  }
  return out;
}

/** Read a file's `passive:` list, fail-soft: a bad entry is dropped with a message. `isReadme` sets the default trigger. */
export function parsePassive(fm: Record<string, unknown> | null | undefined, isReadme: boolean): { passives: PassiveDecl[]; errors: string[] } {
  const raw = fm?.passive;
  if (raw === undefined || raw === null) return { passives: [], errors: [] };
  if (!Array.isArray(raw)) return { passives: [], errors: ['passive must be a list'] };
  const errors: string[] = [];
  const passives: PassiveDecl[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const where = `passive[${i}]`;
    if (!isObj(entry)) return void errors.push(`${where} must be a mapping`);
    const known = new Set(['id', 'skill', 'difficulty', 'on', 'when', 'say', 'find', 'great']);
    for (const k of Object.keys(entry)) if (!known.has(k)) errors.push(`${where}.${k}: unknown key`);
    if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) return void errors.push(`${where}.id must be lowercase letters, digits and "-"`);
    if (seen.has(entry.id)) return void errors.push(`${where}.id "${entry.id}" is declared twice`);
    seen.add(entry.id);
    if (typeof entry.skill !== 'string' || !SKILL_ID_RE.test(entry.skill) || entry.skill === 'sanity') return void errors.push(`${where}.skill must be a sheet skill id`);
    const on = entry.on ?? (isReadme ? 'enter' : 'look');
    if (on !== 'enter' && on !== 'look') return void errors.push(`${where}.on must be enter or look`);
    if (on === 'enter' && !isReadme) return void errors.push(`${where}: on: enter belongs to a place README; a card's passive is on: look`);
    if (entry.difficulty !== undefined && typeof entry.difficulty !== 'string' && typeof entry.difficulty !== 'number') errors.push(`${where}.difficulty is regular / hard / extreme or a DC`);
    let when: PassiveDecl['when'];
    if (entry.when !== undefined) {
      const w = entry.when;
      const list = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= 12 && v.every((p) => typeof p === 'string' && PATH_RE.test(p));
      if (!isObj(w) || Object.keys(w).some((k) => !['has', 'lacks', 'expr'].includes(k))
        || (w.has !== undefined && !list(w.has)) || (w.lacks !== undefined && !list(w.lacks))
        || (w.expr !== undefined && !text(w.expr, 600))) {
        errors.push(`${where}.when takes has / lacks (path lists) and expr (a condition)`);
      } else {
        when = { ...(w.has ? { has: w.has as string[] } : {}), ...(w.lacks ? { lacks: w.lacks as string[] } : {}), ...(w.expr ? { expr: w.expr as string } : {}) };
      }
    }
    const reward = rewardOf(entry, where, errors);
    if (!reward.say && !reward.find) return void errors.push(`${where} gives nothing: it needs a say, a find, or both`);
    let great: PassiveReward | undefined;
    if (entry.great !== undefined) {
      if (!isObj(entry.great)) errors.push(`${where}.great must be a mapping with say / find`);
      else {
        great = rewardOf(entry.great, `${where}.great`, errors);
        if (!great.say && !great.find) great = undefined;
      }
    }
    passives.push({
      id: entry.id,
      skill: entry.skill,
      ...(entry.difficulty !== undefined ? { difficulty: entry.difficulty as string | number } : {}),
      on,
      ...(when ? { when } : {}),
      ...reward,
      ...(great ? { great } : {}),
    });
  });
  return { passives, errors };
}

/** The log key of one declaration. */
export const passiveKey = (file: string, id: string): string => `${file}#${id}`;

export interface PassiveLogEntry {
  grade: string;
  by: string;
}

/** world/README.md `passive_log`: file#id → how it went (tried once per loop). Fail-soft. */
export function parsePassiveLog(raw: unknown): Record<string, PassiveLogEntry> {
  const out: Record<string, PassiveLogEntry> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isObj(v) || typeof v.grade !== 'string' || typeof v.by !== 'string') continue;
    out[k] = { grade: v.grade, by: v.by };
  }
  return out;
}

/** Every find path a declaration can create (check:worlds: never pre-placed, never a key clue). */
export function passiveFindPaths(decl: PassiveDecl): string[] {
  return [decl.find?.path, decl.great?.find?.path].filter((p): p is string => typeof p === 'string');
}
