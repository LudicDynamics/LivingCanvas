/**
 * The player / world / character panels:
 * every declared state as the author's prose (`mappedStates` — hidden states
 * never leave the server, numbers only when the author chose no bands), plus
 * the few facts the world hover says around them. Read-only; there is no HUD —
 * the page opens these on a click (player) or a hover (world).
 */
import { Router } from 'express';
import {
  ABILITIES,
  ABILITY_LABELS,
  SYSTEM_LABELS,
  dndSkillModifier,
  livingPanelLines,
  mappedStates,
  parseFrontmatter,
  parseSheet,
  skillLocaleOf,
  skillUseOf,
  characterWithPlayer,
  inspirationStatus,
  worldRulesOf,
  type InspirationStatus,
  type LocalWorldStore,
  type MappedState,
  type WorldRules,
} from '@airp/shared';

export interface WorldPanels {
  player: { states: MappedState[] };
  world: {
    name: string;
    mode: 'open' | 'semi' | 'closed';
    states: MappedState[];
    /** Closed / semi worlds only: places entered this run over places there are. */
    places: { visited: number; total: number } | null;
  };
  /** Character id → mapped states; a character with none is omitted. */
  characters: Record<string, MappedState[]>;
}

async function statesOf(store: LocalWorldStore, path: string): Promise<MappedState[]> {
  if ((await store.statKind(path)) !== 'file') return [];
  try {
    return mappedStates(parseFrontmatter(await store.readFile(path)).frontmatter ?? {});
  } catch {
    return [];
  }
}

/** Same counting as the settlement (routes/closed-run.ts), without reading any place's name. */
async function placesOf(store: LocalWorldStore): Promise<{ visited: number; total: number }> {
  const all = await store.getEventsSince(0);
  let from = 0;
  all.forEach((e, i) => { if (e.type === 'world_rolled_back') from = i + 1; });
  const entered = new Set(
    all
      .slice(from)
      .filter((e) => e.type === 'layer_entered')
      .map((e) => String((e.detail as Record<string, unknown>)?.layer ?? e.layer ?? '')),
  );
  let visited = 0;
  let total = 0;
  for (const dir of await store.listDirs('world')) {
    if (dir === 'world') continue;
    if ((await store.statKind(`${dir}/README.md`)) !== 'file') continue;
    total += 1;
    if (entered.has(dir)) visited += 1;
  }
  return { visited, total };
}

export async function worldPanels(store: LocalWorldStore): Promise<WorldPanels> {
  const manifest = await store.getManifest();
  const mode = (manifest.mode ?? 'open') as WorldPanels['world']['mode'];
  // A living world: the hour and today's events
  // lead the world panel; what each resident is doing leads theirs.
  const living = await livingPanelLines(store);
  const characters: Record<string, MappedState[]> = {};
  for (const c of manifest.characters ?? []) {
    const states = [...(living?.characters[c.id] ?? []), ...await statesOf(store, `characters/${c.id}/README.md`)];
    if (states.length > 0) characters[c.id] = states;
  }
  return {
    player: { states: await statesOf(store, 'player/README.md') },
    world: {
      name: manifest.name ?? '',
      mode,
      states: [...(living?.world ?? []), ...await statesOf(store, 'world/README.md')],
      places: mode === 'open' ? null : await placesOf(store),
    },
    characters,
  };
}

/**
 * A character sheet as the page shows it:
 * labels in the world's language, coc percentages with their hard / extreme
 * targets, dnd modifiers already summed, and the improvement marks.
 */
export interface SheetSkillView {
  id: string;
  label: string;
  desc?: string;
  /** coc */
  value?: number;
  half?: number;
  fifth?: number;
  /** dnd */
  modifier?: number;
  ability?: string;
  proficient?: boolean;
  expertise?: boolean;
  marked?: boolean;
  /** A companion lends this skill to the player while with them. */
  assist?: boolean;
}
export interface SheetView {
  abilities?: Array<{ id: string; label: string; modifier: number }>;
  /** A character's name (the page lists the companions with the player by it). */
  name?: string;
  skills: SheetSkillView[];
}
export interface WorldSheets {
  rules: (WorldRules & { label: string }) | null;
  player: SheetView | null;
  /** Character id → sheet; a character with none is omitted. */
  characters: Record<string, SheetView>;
  /** Characters with a sheet who are with the player now (following, or on `layer`): their assists count. */
  with: string[];
  /** The inspiration roll: its number and whether it can be rolled now. */
  inspiration: InspirationStatus | null;
}

async function sheetOf(store: LocalWorldStore, path: string, rules: WorldRules, locale: unknown): Promise<SheetView | null> {
  if ((await store.statKind(path)) !== 'file') return null;
  try {
    const fm = parseFrontmatter(await store.readFile(path)).frontmatter ?? {};
    const { sheet } = parseSheet(fm, rules.system, locale);
    if (!sheet) return null;
    const status = (fm.status ?? {}) as { data?: { skill_marks?: unknown } };
    const marks = new Set(Array.isArray(status.data?.skill_marks) ? status.data!.skill_marks.filter((m): m is string => typeof m === 'string') : []);
    const lang = skillLocaleOf(locale);
    // What each skill is for: the sheet's own desc, else the catalog line;
    // and whether a companion lends it to the player (`assist`).
    const descOf = (s: { id: string; desc?: string; assist?: boolean }) => {
      const use = skillUseOf(s.id, s.desc, locale);
      return { ...(use ? { desc: use } : {}), ...(s.assist ? { assist: true } : {}) };
    };
    return {
      ...(rules.system === 'dnd'
        ? { abilities: ABILITIES.map((a) => ({ id: a, label: ABILITY_LABELS[a][lang], modifier: sheet.abilities?.[a] ?? 0 })) }
        : {}),
      skills: sheet.skills.map((s) => rules.system === 'coc'
        ? { id: s.id, label: s.label, ...descOf(s), value: s.value, half: Math.max(1, Math.floor((s.value ?? 1) / 2)), fifth: Math.max(1, Math.floor((s.value ?? 1) / 5)), ...(marks.has(s.id) ? { marked: true } : {}) }
        : { id: s.id, label: s.label, ...descOf(s), modifier: dndSkillModifier(sheet, s, rules.proficiency), ability: s.ability, ...(s.proficient ? { proficient: true } : {}), ...(s.expertise ? { expertise: true } : {}) }),
    };
  } catch {
    return null;
  }
}

/** Every sheet in the loaded world; `rules: null` (and nothing else) when the world has no skill rules. */
export async function worldSheets(store: LocalWorldStore, layer?: string | null): Promise<WorldSheets> {
  const manifest = await store.getManifest();
  const rules = worldRulesOf(manifest);
  if (!rules) return { rules: null, player: null, characters: {}, with: [], inspiration: null };
  const locale = (manifest as { locale?: unknown }).locale;
  const characters: Record<string, SheetView> = {};
  for (const c of manifest.characters ?? []) {
    const sheet = await sheetOf(store, `characters/${c.id}/README.md`, rules, locale);
    if (sheet) characters[c.id] = { ...sheet, name: c.name ?? c.id };
  }
  let page = typeof layer === 'string' && manifest.layers[layer] ? layer : null;
  if (!page) {
    try { page = store.readViewpoint()?.layer ?? null; } catch { page = null; }
  }
  const withPlayer: string[] = [];
  for (const id of Object.keys(characters)) if (await characterWithPlayer(store, id, page ?? 'map')) withPlayer.push(id);
  const ctx = { store, actor: { type: 'player' as const }, turn: 'sheets' };
  return {
    rules: { ...rules, label: SYSTEM_LABELS[rules.system][skillLocaleOf(locale)] },
    player: await sheetOf(store, 'player/README.md', rules, locale),
    characters,
    with: withPlayer,
    inspiration: await inspirationStatus(ctx).catch(() => null),
  };
}

export function createPanelsRouter(getStore: () => LocalWorldStore | null): Router {
  const router = Router();
  router.get('/world/panels', async (_req, res) => {
    const store = getStore();
    if (!store) {
      res.status(404).json({ ok: false, error: 'No world is loaded.' });
      return;
    }
    try {
      res.json({ ok: true, ...(await worldPanels(store)) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  // Character sheets: read-only, opened from
  // the player's avatar or a character's modal — never a HUD.
  router.get('/world/sheets', async (req, res) => {
    const store = getStore();
    if (!store) {
      res.status(404).json({ ok: false, error: 'No world is loaded.' });
      return;
    }
    try {
      const layer = typeof req.query.layer === 'string' && /^(map|world\/[A-Za-z0-9_/-]+)$/.test(req.query.layer) ? req.query.layer : null;
      res.json({ ok: true, ...(await worldSheets(store, layer)) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  return router;
}
