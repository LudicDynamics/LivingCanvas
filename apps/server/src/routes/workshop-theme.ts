/**
 * Creation-mode 设定: the world type, rule pack and
 * structure flags the create form picked, editable again while the world is
 * the author's draft.
 *
 *   GET  /api/workshop/theme   the stored theme (resolved) and the registry ids the form offers
 *   POST /api/workshop/theme   { theme }  validate, write world.json `theme` + `mode`, merge the new defaults
 *   POST /api/workshop/clear-play          reset play traces in the draft itself (backed up first)
 *
 * Same guard as the 素材 routes (`draftWorld`): only the author's own DRAFT.
 * Saving merges the new theme's default states into player/world/character
 * READMEs by id and never deletes one: states the old theme brought stay (the
 * author may have written play around them). The answer names the ones the new
 * theme no longer brings, so the panel can say so.
 */
import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AVAILABLE_PLAYER_MODES,
  RULE_PACKS,
  STRUCTURE_FLAGS,
  WORLD_TYPES,
  modeOfTheme,
  parseFrontmatter,
  parseTheme,
  resolveTheme,
  themeStateDecls,
  themeSkillRules,
  parseSheet,
  worldRulesOf,
  stringifyFrontmatter,
  type LocalWorldStore,
  type WorldTheme,
} from '@airp/shared';
import { WorkshopError, writeDefaultSheets, writeThemeStates, type WorkshopLocale } from '../world-workshop.js';
import { draftWorld, failure, readJson } from './workshop-art.js';
import { playHistoryOf, resetPlayState } from '../world-play-reset.js';

export interface WorkshopThemeOptions {
  getStore: () => LocalWorldStore | null;
}

/** Default states the old theme brought, the new one does not, and a README still declares. */
export interface UnusedThemeStates {
  player: string[];
  world: string[];
  character: string[];
}

const localeOf = (raw: unknown): WorkshopLocale => (raw === 'zh-CN' || raw === 'ja' || raw === 'ko' ? raw : 'en');

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** Every character the world has: world.json entries and `characters/<id>/` folders. */
async function characterIds(root: string, manifest: Record<string, unknown>): Promise<string[]> {
  const ids = new Set<string>();
  for (const c of Array.isArray(manifest.characters) ? manifest.characters : []) {
    const id = typeof c === 'object' && c !== null ? (c as { id?: unknown }).id : undefined;
    if (typeof id === 'string' && ID.test(id)) ids.add(id);
  }
  const dirs = await fs.readdir(path.join(root, 'characters'), { withFileTypes: true }).catch(() => []);
  for (const d of dirs) if (d.isDirectory() && ID.test(d.name)) ids.add(d.name);
  return [...ids];
}

async function declaredIds(root: string, rel: string): Promise<Set<string>> {
  const text = await fs.readFile(path.join(root, rel), 'utf8').catch(() => null);
  if (text === null) return new Set();
  try {
    const states = parseFrontmatter(text).frontmatter?.states;
    return new Set((Array.isArray(states) ? states : []).flatMap((s) => (typeof s === 'object' && s !== null && typeof (s as { id?: unknown }).id === 'string' ? [(s as { id: string }).id] : [])));
  } catch {
    return new Set();
  }
}

/** Exported for tests. */
export async function unusedThemeStates(root: string, before: WorldTheme, after: WorldTheme, locale: WorkshopLocale, characters: readonly string[]): Promise<UnusedThemeStates> {
  const was = themeStateDecls(before, locale);
  const now = themeStateDecls(after, locale);
  const dropped = (scope: keyof UnusedThemeStates) => was[scope].map((d) => d.id).filter((id) => !now[scope].some((d) => d.id === id));
  const player = await declaredIds(root, 'player/README.md');
  const world = await declaredIds(root, 'world/README.md');
  const inCharacters = new Set<string>();
  for (const id of characters) for (const s of await declaredIds(root, `characters/${id}/README.md`)) inCharacters.add(s);
  return {
    player: dropped('player').filter((id) => player.has(id)),
    world: dropped('world').filter((id) => world.has(id)),
    character: dropped('character').filter((id) => inCharacters.has(id)),
  };
}

function themeOfBody(body: unknown): WorldTheme {
  const raw = (body as { theme?: unknown } | null)?.theme;
  let theme: WorldTheme | null;
  try {
    theme = parseTheme(raw);
  } catch (error) {
    throw new WorkshopError(400, 'invalid_argument', error instanceof Error ? error.message : 'Invalid theme.');
  }
  if (!theme) throw new WorkshopError(400, 'invalid_argument', 'theme is required.');
  return theme;
}

const OPTIONS = {
  players: [...AVAILABLE_PLAYER_MODES],
  types: WORLD_TYPES.map((t) => t.id),
  rules: RULE_PACKS.map((r) => r.id),
  flags: STRUCTURE_FLAGS.map((f) => f.id),
};

export function createWorkshopThemeRouter(options: WorkshopThemeOptions): Router {
  const router = Router();

  router.get('/workshop/theme', async (_req, res) => {
    try {
      const { manifest } = await draftWorld(options.getStore);
      const theme = resolveTheme(manifest.theme);
      res.json({ ok: true, world: manifest.id, theme, mode: modeOfTheme(theme), stored: manifest.theme !== undefined, options: OPTIONS });
    } catch (err) {
      failure(res, err);
    }
  });

  router.post('/workshop/theme', async (req, res) => {
    try {
      const { store, manifest } = await draftWorld(options.getStore);
      const theme = themeOfBody(req.body);
      const before = resolveTheme(manifest.theme);
      const locale = localeOf(manifest.locale);
      // Re-read under the guard's answer and write only the two fields: the
      // rest of world.json (triggers, endings, characters) is the writer's.
      const next = await readJson(store);
      // Character skills follow the rule pack.
      // Switching CoC ↔ D&D replaces the sheets: the team (2026-10-04) — ask first.
      // Without `confirmReset: true` the answer is a 409 naming the sheets that
      // would be replaced, and NOTHING is written (cancel keeps the old system).
      const rulesBefore = worldRulesOf(next);
      const skillRules = themeSkillRules(theme);
      if (skillRules && rulesBefore && rulesBefore.system !== skillRules.system && (req.body as { confirmReset?: unknown })?.confirmReset !== true) {
        const characters = await characterIds(store.worldRoot, next);
        const replace: string[] = [];
        for (const target of ['player', ...characters]) {
          const rel = target === 'player' ? 'player/README.md' : `characters/${target}/README.md`;
          const text = await fs.readFile(path.join(store.worldRoot, rel), 'utf8').catch(() => null);
          if (text !== null && parseFrontmatter(text).frontmatter?.sheet !== undefined) replace.push(rel);
        }
        if (replace.length > 0) {
          res.status(409).json({ ok: false, code: 'sheets_reset_required', error: 'Switching the rule system replaces the character sheets.', from: rulesBefore.system, to: skillRules.system, replace });
          return;
        }
      }
      next.theme = theme;
      next.mode = modeOfTheme(theme);
      if (skillRules) next.rules = { ...(typeof next.rules === 'object' && next.rules ? next.rules : {}), ...skillRules };
      else delete next.rules;
      // Default music follows the type — but only while it is still the old
      // type's default (or unset): music the author chose on purpose stays.
      const defaultOf = (t: WorldTheme) => WORLD_TYPES.find((w) => w.id === t.type)?.audioTheme;
      const audio = (next.audio && typeof next.audio === 'object' ? next.audio : {}) as { theme?: unknown };
      const nextDefault = defaultOf(theme);
      if (nextDefault && (audio.theme === undefined || audio.theme === defaultOf(before))) {
        next.audio = { ...audio, theme: nextDefault };
      }
      next.updatedAt = new Date().toISOString();
      await store.writeFileAtomic('world.json', JSON.stringify(next, null, 2) + '\n');
      await store.getManifest().catch(() => undefined);
      const characters = await characterIds(store.worldRoot, next);
      await writeThemeStates(store.worldRoot, theme, locale, characters.map((id) => ({ id })));
      const unused = await unusedThemeStates(store.worldRoot, before, theme, locale, characters);
      // A new rule system replaces the draft's sheets with its defaults (the old
      // system's sheets cannot be read under the new one); the answer names them.
      const sheetsReset = skillRules
        ? await writeDefaultSheets(store.worldRoot, skillRules.system, locale, characters.map((id) => ({ id })), rulesBefore !== null && rulesBefore.system !== skillRules.system)
        : [];
      res.json({ ok: true, world: next.id, theme, mode: next.mode, unused, ...(skillRules ? { rules: next.rules } : {}), sheetsReset });
    } catch (err) {
      failure(res, err);
    }
  });

  // Character sheets in the draft: the
  // protagonist's and every character's, raw, for the 设定 page's sheet editor.
  router.get('/workshop/sheets', async (_req, res) => {
    try {
      const { store, manifest } = await draftWorld(options.getStore);
      const rules = worldRulesOf(manifest);
      if (!rules) { res.json({ ok: true, rules: null, sheets: {} }); return; }
      const sheets: Record<string, unknown> = {};
      for (const target of ['player', ...(await characterIds(store.worldRoot, manifest as Record<string, unknown>))]) {
        const rel = target === 'player' ? 'player/README.md' : `characters/${target}/README.md`;
        const text = await fs.readFile(path.join(store.worldRoot, rel), 'utf8').catch(() => null);
        if (text === null) continue;
        const { sheet } = parseSheet(parseFrontmatter(text).frontmatter ?? {}, rules.system, manifest.locale);
        if (sheet) sheets[target] = sheet;
      }
      res.json({ ok: true, rules, sheets, locale: localeOf(manifest.locale) });
    } catch (err) {
      failure(res, err);
    }
  });

  // Save one sheet: { target: 'player' | '<character id>', sheet }. Strict — a
  // sheet with any problem is a 400 naming them; nothing is half-written.
  router.post('/workshop/sheet', async (req, res) => {
    try {
      const { store, manifest } = await draftWorld(options.getStore);
      const rules = worldRulesOf(manifest);
      if (!rules) throw new WorkshopError(409, 'no_rules', 'This world has no skill rules; pick a CoC or D&D rule pack first.');
      const target = (req.body as { target?: unknown })?.target;
      const raw = (req.body as { sheet?: unknown })?.sheet;
      if (typeof target !== 'string' || (target !== 'player' && !ID.test(target))) throw new WorkshopError(400, 'invalid_argument', 'target is player or a character id.');
      const rel = target === 'player' ? 'player/README.md' : `characters/${target}/README.md`;
      const text = await fs.readFile(path.join(store.worldRoot, rel), 'utf8').catch(() => null);
      if (text === null && target !== 'player') throw new WorkshopError(404, 'not_found', `${rel} does not exist.`);
      const { sheet, errors } = parseSheet({ sheet: raw }, rules.system, manifest.locale);
      if (!sheet || errors.length) throw new WorkshopError(400, 'invalid_sheet', errors.join('; ') || 'sheet must be a mapping');
      if (sheet.skills.length === 0) throw new WorkshopError(400, 'invalid_sheet', 'A sheet lists at least one skill.');
      const parsed = text === null ? null : parseFrontmatter(text);
      const fm: Record<string, unknown> = { ...(parsed?.frontmatter ?? { type: 'readme', title: target }) };
      fm.sheet = sheet;
      await store.writeFileAtomic(rel, stringifyFrontmatter(fm, parsed ? parsed.body : '\n'));
      res.json({ ok: true, target, sheet });
    } catch (err) {
      failure(res, err);
    }
  });

  // 「清除草稿里的试玩痕迹」: the same reset a
  // trial copy gets, run on the draft itself — for a draft that was played in
  // place before trials existed. Every text file is backed up first under
  // `.airpworld/backups/`; the draft keeps its sessions and markers.
  router.post('/workshop/clear-play', async (_req, res) => {
    try {
      const { store } = await draftWorld(options.getStore);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupRel = `.airpworld/backups/play-reset-${stamp}`;
      const history = await playHistoryOf(store.worldRoot, store);
      const report = await resetPlayState(store.worldRoot, { history, store, backupDir: path.join(store.worldRoot, backupRel) });
      await store.getManifest().catch(() => undefined);
      res.json({ ok: true, backup: backupRel, ...report });
    } catch (err) {
      failure(res, err);
    }
  });

  return router;
}
