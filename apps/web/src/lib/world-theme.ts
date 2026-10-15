/**
 * World themes on the client: the create form's draft
 * and the first-entry intro's gating. Pure; the registry itself lives in
 * `@airp/shared/themes` so the form, the server and the writer read one table.
 */
import {
  RULE_PACKS,
  STRUCTURE_FLAGS,
  WORLD_CATEGORIES,
  WORLD_TYPES,
  categoryOfType,
  modeOfTheme,
  normalizeFlags,
  themeFromType,
  worldTypeOf,
  type StructureFlag,
  type StructureFlags,
} from '@airp/shared/themes';
import type { WorldIntroFields, WorldIntroState, WorldThemeRequest } from './airp-gateway.js';

export { RULE_PACKS, STRUCTURE_FLAGS, WORLD_CATEGORIES, WORLD_TYPES };

/**
 * The picker offers the three world categories, not the
 * seven older types: a category's button writes its live type. A world that
 * stores an older type keeps it (and its writer rules) until the author picks
 * a category; its button shows as the one that type folds into.
 */
export const pickerCategoryOf = (draft: ThemeDraft): string | null => categoryOfType(draft.type)?.id ?? null;

/** What the create form edits. Picking a type resets rules and flags to its preset. */
export interface ThemeDraft {
  type: string;
  rules: string;
  structure: StructureFlags;
}

export const DEFAULT_WORLD_TYPE = 'trpg';

export function themeDraftFor(typeId: string): ThemeDraft {
  const theme = themeFromType(typeId) ?? themeFromType(DEFAULT_WORLD_TYPE)!;
  return { type: theme.type ?? DEFAULT_WORLD_TYPE, rules: theme.rules, structure: theme.structure };
}

/** Flip one flag; a flag whose prerequisite goes off goes off with it. */
export function toggleThemeFlag(draft: ThemeDraft, flag: StructureFlag, on: boolean): ThemeDraft {
  return { ...draft, structure: normalizeFlags({ ...draft.structure, [flag]: on }) };
}

/** Whether a flag can be switched on right now (`clock` needs `endings`). */
export function flagAvailable(draft: ThemeDraft, flag: StructureFlag): boolean {
  const requires = STRUCTURE_FLAGS.find((entry) => entry.id === flag)?.requires;
  return !requires || draft.structure[requires];
}

/** The world is a sandbox exactly when it has no endings. */
export const isSandbox = (draft: ThemeDraft): boolean => !draft.structure.endings;

/** Does this type roll dice at all? Companion life does not, so its rules picker is moot. */
export const draftUsesDice = (draft: ThemeDraft): boolean => (worldTypeOf(draft.type)?.dice ?? 'full') !== 'none';

export function themeRequestOf(draft: ThemeDraft): WorldThemeRequest {
  return { players: 'single', ...(draft.type ? { type: draft.type } : {}), rules: draft.rules, structure: { ...draft.structure } };
}

export const draftMode = (draft: ThemeDraft) => modeOfTheme({ players: 'single', ...draft });

/**
 * The view the create form suggests: a world that
 * ends — a TRPG run through places, semi or closed — opens on the map; an open
 * sandbox opens on the canvas. Only a suggestion: the author's pick wins.
 */
export const suggestedViewOf = (draft: ThemeDraft): 'canvas' | 'map' => (draftMode(draft) === 'open' ? 'canvas' : 'map');

/**
 * A stored theme (world.json, via `GET /api/workshop/theme`) → what the 设定
 * tab edits. A theme written before types existed has no `type`: the draft
 * keeps it empty (no type highlighted) until the author picks one, and the
 * request then omits it, so the rules and flags stand on their own.
 */
export function themeDraftOf(theme: { type?: string; rules: string; structure: Record<string, boolean> }): ThemeDraft {
  return {
    type: theme.type && worldTypeOf(theme.type) ? theme.type : '',
    rules: RULE_PACKS.some((pack) => pack.id === theme.rules) ? theme.rules : 'narrative',
    structure: normalizeFlags(theme.structure),
  };
}

/** Whether two drafts would store the same theme (the 设定 tab's Save is idle until they differ). */
export function sameThemeDraft(a: ThemeDraft, b: ThemeDraft): boolean {
  return a.type === b.type && a.rules === b.rules && STRUCTURE_FLAGS.every((flag) => a.structure[flag.id] === b.structure[flag.id]);
}

// ---------------------------------------------------------------------------
// The first-entry intro
// ---------------------------------------------------------------------------

/**
 * Where the intro stands for the world on screen. `checking` while the marker
 * is being read, `open` while the popup shows, `done` once it is dismissed or
 * the world has none. Keyed by world id so a world switch starts over.
 */
export interface IntroGate {
  worldId: string | null;
  status: 'checking' | 'open' | 'done';
  state: WorldIntroState | null;
}

export const INITIAL_INTRO_GATE: IntroGate = { worldId: null, status: 'done', state: null };

/** The marker answered: open only for a workshop world whose save has not seen it. */
export function introGateFrom(worldId: string, state: WorldIntroState | null): IntroGate {
  if (!state || !state.workshop || state.shown) return { worldId, status: 'done', state };
  return { worldId, status: 'open', state };
}

/**
 * The forced tutorial waits for the intro: while a workshop world's marker is
 * still being read, or the popup is up. A curated world never waits; a failed
 * marker read releases the tutorial (the gate goes `done`).
 */
export function tutorialHeldByIntro(gate: IntroGate, worldId: string | undefined, workshop: boolean): boolean {
  if (!worldId || !workshop) return false;
  if (gate.worldId !== worldId) return true; // not read yet for this world
  return gate.status !== 'done';
}

/** One field's 一键填写: take the suggestion for that field only; everything else stays as typed. */
export function applyIntroSuggestion(fields: WorldIntroFields, suggested: WorldIntroFields, field: keyof WorldIntroFields): WorldIntroFields {
  return { ...fields, [field]: suggested[field] || fields[field] };
}

/** The request for one field's fill: that field blank, the others as context. */
export function introSuggestRequest(fields: WorldIntroFields, field: keyof WorldIntroFields): WorldIntroFields {
  return { ...fields, [field]: '' };
}
