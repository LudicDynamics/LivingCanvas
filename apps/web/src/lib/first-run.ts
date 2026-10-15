/// <reference types="vite/client" />
/**
 * The first-run experience: a new visitor confirms a language (one tap), plays
 * 末班车 · 序章 as a guest (five minutes, six beats, one ending), and the ending offers two choices —
 * 「继续这趟车：末班车完整版」 (the full 末班车 in the prologue's language, still as a guest) or 「看看所有世界」.
 * Returning visitors go to the lobby as before.
 *
 * Everything here is behind the build flag VITE_AIRP_FIRST_RUN (config/.env.remote 0, config/.env.local 1):
 * off, the page is exactly what it was. And it needs a way to play signed out — the guest trial (remote) or
 * a build that plays without an account (local) — or it stays off: a sign-in wall on screen one is worse
 * than the lobby (§1.3).
 *
 * Pure decisions first (tested in apps/web/test/first-run.test.mjs), then the few storage helpers.
 */
import { editionIdFor } from '@airp/shared/experience';
import type { AccountMode } from './play-gate.js';

/** `localStorage['airp.first-run']`: `done` once the prologue ended or the player chose the lobby. */
export const FIRST_RUN_KEY = 'airp.first-run';
/** The forced tutorial's 「不再显示」 key (lib/forced-tutorial.ts): written when the prologue ends. */
export const TUTORIAL_HIDDEN_KEY = 'airp:tutorial:hidden';
/** The prologue's edition family. */
export const PROLOGUE_BASE = 'last-train-prologue';
/** Where the prologue's ending leads (its world.json `experience.next`): the edition family of the next world —
 * the full 末班车. */
export const PROLOGUE_NEXT_BASE = 'last-train';

/**
 * The ending's first choice (pure): the `next` family's edition in the PROLOGUE's language — the same suffix as the
 * prologue edition (`last-train-prologue-jp` → `last-train-jp`), else the world's own language, else the interface's.
 */
export function prologueNextIdFor(next: string | null | undefined, prologueId: unknown, worldLocale: string | null | undefined, locale: string): string | null {
  if (!next) return null;
  const m = typeof prologueId === 'string' ? new RegExp(`^${PROLOGUE_BASE}(-zh|-jp|-ko)?$`).exec(prologueId) : null;
  if (m) return `${next}${m[1] ?? ''}`;
  return editionIdFor(next, worldLocale || locale);
}

/**
 * Entering the full 末班车 from the prologue's ending: `sessionStorage['airp.from-prologue']` holds
 * the edition opened, so that world — this tab only — gets the one-line bridge and the guide's hand-over.
 */
export const FROM_PROLOGUE_KEY = 'airp.from-prologue';
export function markFromPrologue(worldId: string, storage: Pick<Storage, 'setItem'> | null = safeSession()): void {
  try { storage?.setItem(FROM_PROLOGUE_KEY, worldId); } catch { /* storage blocked: the usual guide */ }
}
export function readFromPrologue(storage: Pick<Storage, 'getItem'> | null = safeSession()): string | null {
  try { return storage?.getItem(FROM_PROLOGUE_KEY) ?? null; } catch { return null; }
}

/**
 * The onboarding guide's hand-over (lib/onboarding.ts HANDOFF_STEPS, the design notes), pure: in the full 末班车 opened
 * from the prologue's ending (`fromPrologue` = that edition's id), the guide says only the writer line.
 */
export const isHandoffWorld = (worldId: unknown, fromPrologue: string | null): boolean =>
  typeof worldId === 'string' && fromPrologue === worldId && new RegExp(`^${PROLOGUE_NEXT_BASE}(-zh|-jp|-ko)?$`).test(worldId);

const ENV = ((import.meta as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;
/** Is the first-run experience part of this build? */
export const firstRunBuild = (env: Record<string, string | undefined> = ENV): boolean => (env.VITE_AIRP_FIRST_RUN ?? '').trim() === '1';

/** The prologue edition for an interface language (`zh-CN` → `last-train-prologue-zh`, `en` → `last-train-prologue`). */
export const prologueIdFor = (locale: string): string => editionIdFor(PROLOGUE_BASE, locale);
/** Is this a prologue edition id (any language)? */
export const isPrologueId = (id: unknown): boolean => typeof id === 'string' && (id === PROLOGUE_BASE || /^last-train-prologue-(zh|jp|ko)$/.test(id));

/**
 * How a signed-out visitor gets into the prologue here:
 *   `go`      — no account needed (local without an account requirement or asking only for shared worlds,
 *               no account system);
 *   `guest`   — the guest trial (POST /api/remote/guest);
 *   `sign-in` — only after signing in (the trial is off): the prologue opens behind the sign-in card;
 *   `signed-in` — someone is signed in already (a returning visitor).
 */
export type FirstRunAccess = 'go' | 'guest' | 'sign-in' | 'signed-in';
export function firstRunAccessOf(mode: AccountMode): FirstRunAccess {
  if (mode.kind === 'none') return 'go';
  if (mode.kind === 'hosted') return mode.signedIn ? 'signed-in' : 'sign-in';
  if (mode.signedIn) return 'signed-in';
  // The local edition (login on) asks only for shared worlds; the prologue ships with the game.
  if (!mode.required || mode.sharedOnly) return 'go';
  return mode.guestTrial ? 'guest' : 'sign-in';
}

export interface FirstRunGroup { id: string; saves: readonly { path: string; updatedAt?: string }[] }

export interface FirstRunInput {
  /** The build flag (VITE_AIRP_FIRST_RUN). */
  flag: boolean;
  /** `?first-run=1`: run it again on purpose (local testing) — returning-visitor checks skipped. */
  forced: boolean;
  /** The link opens a particular world (`?world=`, an invitation): follow the link instead. */
  deepLink: boolean;
  access: FirstRunAccess;
  /** `localStorage['airp.first-run']`. */
  mark: string | null;
  /** Did the player (or a `?lang=` link) already choose the interface language? */
  localeChosen: boolean;
  /** The shelf's groups (templates and their saves on this device). */
  groups: readonly FirstRunGroup[];
}

export type FirstRunDecision =
  /** The page as it was: the lobby. `reason` for tests and the console. */
  | { kind: 'off'; reason: 'flag' | 'link' | 'returning' }
  /** The only save here is an unfinished prologue: back into it. */
  | { kind: 'resume'; path: string }
  /** A new visitor: the language screen (unless already chosen), then the prologue. */
  | { kind: 'start'; askLanguage: boolean };

/** The local server's boot save (`worlds/wuwu-default`): not a sign of a returning player. */
export const isBootCopy = (savePath: string): boolean => /(^|\/)[a-z0-9][a-z0-9-]*-default$/.test(savePath);

const newest = (saves: readonly { path: string; updatedAt?: string }[]) =>
  [...saves].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0] ?? null;

/**
 * Pure: what this page load does. Whether a guest session can be had does NOT decide
 * whether the language screen shows: a new visitor — and every `?first-run=1` — always gets it;
 * only where the pick lands depends on access (`firstRunEntryOf`), and it is always the prologue, never the lobby.
 */
export function decideFirstRun(input: FirstRunInput): FirstRunDecision {
  if (!input.flag) return { kind: 'off', reason: 'flag' };
  if (input.deepLink) return { kind: 'off', reason: 'link' };
  if (input.forced) return { kind: 'start', askLanguage: true };
  const prologueSaves = input.groups.filter((g) => isPrologueId(g.id)).flatMap((g) => g.saves);
  // The local server's boot copy (`worlds/<template>-default`, apps/server index.ts) is made for everyone at the
  // first start: it says nothing about having played.
  const otherSaves = input.groups.filter((g) => !isPrologueId(g.id)).some((g) => g.saves.some((s) => !isBootCopy(s.path)));
  if (input.access === 'signed-in' || input.mark === 'done' || otherSaves) return { kind: 'off', reason: 'returning' };
  const resume = newest(prologueSaves);
  if (resume) return { kind: 'resume', path: resume.path };
  // The screen always shows for a new visitor: it is also where 「直接试玩」 / 「看看所有世界」 is
  // chosen. A language already chosen (?lang=, stored) only preselects its button.
  return { kind: 'start', askLanguage: true };
}

/**
 * Where a language-screen pick lands (pure; the design notes ①, §9.5): every button — the guessed one or another
 * language — sets that language and opens THAT language's prologue. Never the lobby during a first run.
 *   `load`  — straight in (no account needed / signed in);
 *   `guest` — a guest session first (POST /api/remote/guest), then in; if it cannot be had → `gate`;
 *   `gate`  — the prologue's opening scene (art + the greeter's written line, no model call) with the sign-in card
 *             over the reply box; after sign-in it carries on in the prologue.
 */
export type FirstRunEntry = 'load' | 'guest' | 'gate';
export const firstRunEntryOf = (access: FirstRunAccess): FirstRunEntry => (access === 'guest' ? 'guest' : access === 'sign-in' ? 'gate' : 'load');
export interface FirstRunPick { locale: string; prologueId: string; entry: FirstRunEntry }
export function planFirstRunPick(pick: string, access: FirstRunAccess): FirstRunPick {
  return { locale: pick, prologueId: prologueIdFor(pick), entry: firstRunEntryOf(access) };
}
/**
 * Why the sign-in card shows (its first line says which): sign-in required here; the trial already used on this
 * device (`trial-used`), on this network (`trial-used-network`, billing's one-per-IP cap) or one of the two
 * (`trial-used-here`, identity's guest cap does not say which); or the trial service not reachable (`unavailable`).
 */
export type FirstRunGate = 'sign-in' | 'trial-used' | 'trial-used-network' | 'trial-used-here' | 'unavailable';
export const gateOfGuestRefusal = (refused: string | null | undefined, by?: string | null): FirstRunGate => {
  if (refused !== 'claim_limited' && refused !== 'guest_limited') return 'unavailable';
  return by === 'device' ? 'trial-used' : by === 'network' ? 'trial-used-network' : 'trial-used-here';
};
/** The card's first line: why this player has to sign in (null: nothing to explain — sign-in is simply required here). */
export const GATE_WHY: Readonly<Record<FirstRunGate, string | null>> = {
  'sign-in': null,
  'trial-used': 'This device has already used its free trial.',
  'trial-used-network': 'The free trial has already been used on this network.',
  'trial-used-here': 'The free trial has already been used on this device or network.',
  unavailable: 'The free trial is not reachable right now.',
};

/** `?first-run=1` (forced) and `?world=` / `?invite=` (a link to a world) in this page's address. */
export function firstRunParams(search: string): { forced: boolean; deepLink: boolean } {
  try {
    const q = new URLSearchParams(search);
    return { forced: q.get('first-run') === '1', deepLink: q.has('world') || q.has('invite') };
  } catch {
    return { forced: false, deepLink: false };
  }
}

/**
 * 「5 分钟序章」 on the full 末班车's intro card (the design notes: the prologue has no tile of its own; it is
 * replayed from the full world's card) — pure: the prologue edition in the same language as the card's world
 * (`last-train-zh` → `last-train-prologue-zh`), when this build ships it and it is on the shelf; else null.
 */
export function prologueReplayFor(worldId: string, groups: readonly { id: string; templatePath?: string | null }[], flag = firstRunBuild()): string | null {
  if (!flag) return null;
  const m = /^last-train(-zh|-jp|-ko)?$/.exec(worldId);
  if (!m) return null;
  const id = `${PROLOGUE_BASE}${m[1] ?? ''}`;
  const group = groups.find((g) => g.id === id);
  return group ? group.templatePath ?? `templates/${id}` : null;
}

/** The path that opens a prologue edition: its shelf template, else `templates/<id>`. */
export function prologuePathOf(groups: readonly { id: string; templatePath?: string | null }[], id: string): string {
  return groups.find((g) => g.id === id)?.templatePath ?? `templates/${id}`;
}

// ── the reply chips ──────────────────

export interface ChipCard { path: string; frontmatter?: Record<string, any> | null }
export interface Chip { path: string; option: { index: number; label: string; id?: string } }

/**
 * Which options sit above the reply box (pure; the prologue and any world with `ui.replyChips`): a door card
 * first (the prologue's climax), then the other cards, then this layer's README (the first card, as the App
 * passes them) — newest beat first, at most `max`. A place's own README seen from outside (a sub-layer's card on
 * this layer: 末班车's overview shows the five cars) carries what to do INSIDE it, so its options come last.
 * Talk options (`kind: character`) are left out: the conversation is already open beside them.
 */
export function replyChipsOf(cards: readonly ChipCard[], optionsOf: (card: ChipCard) => { index: number; label: string; id?: string }[], max = 3): Chip[] {
  const rank = (c: ChipCard, i: number) => {
    const readme = c.path.endsWith('/README.md');
    if (readme && i > 0) return 3;
    if (c.frontmatter?.type === 'gate' && typeof c.frontmatter?.target === 'string') return 0;
    return readme ? 2 : 1;
  };
  const ordered = cards.map((c, i) => ({ c, i, r: rank(c, i) })).sort((a, b) => a.r - b.r || b.i - a.i).map((x) => x.c);
  const out: Chip[] = [];
  const seen = new Set<string>();
  for (const card of ordered) {
    const actions = card.frontmatter?.choice_actions as Record<string, { kind?: unknown }> | undefined;
    for (const option of optionsOf(card)) {
      if (option.id && actions?.[option.id]?.kind === 'character') continue;
      if (seen.has(option.label)) continue;
      seen.add(option.label);
      out.push({ path: card.path, option });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * 「你刚刚：和夏澄说了话 · 找到一本笔记 · 掷了一次骰 · 打开一扇门」 (§3.2 ④), pure: the four moves of this run
 * that happened, in the interface language. `t` is the page's translate.
 */
export function prologueRecap(facts: { spoke: boolean; took: boolean; rolled: boolean; door: boolean }, companion: string, t: (key: string, values?: Record<string, string | number>) => string): string | null {
  const parts = [
    facts.spoke ? t('talked with {name}', { name: companion }) : null,
    facts.took ? t('found a notebook') : null,
    facts.rolled ? t('rolled the dice once') : null,
    facts.door ? t('opened a door') : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? t('You just: {moves}', { moves: parts.join(' · ') }) : null;
}

// ── storage ──────────────────────────────────────────────────────────────────────────

export function readFirstRunMark(storage: Pick<Storage, 'getItem'> | null = safeStorage()): string | null {
  try { return storage?.getItem(FIRST_RUN_KEY) ?? null; } catch { return null; }
}
/** The prologue ended, or the player chose the lobby: the next visit is a returning one. */
export function markFirstRunDone(storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try { storage?.setItem(FIRST_RUN_KEY, 'done'); } catch { /* private mode: they may see it once more */ }
}
/** The prologue taught speaking, taking, rolling and doors: the forced tutorial does not start over in the next world. */
export function hideForcedTutorial(storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try { storage?.setItem(TUTORIAL_HIDDEN_KEY, '1'); } catch { /* storage blocked */ }
}
function safeStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
function safeSession(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
