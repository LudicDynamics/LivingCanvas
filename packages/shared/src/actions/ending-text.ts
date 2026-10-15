/**
 * The ending card's words. One ending is reached from many different runs —
 * 「末班车」's `found` with the logbook page in hand or with the pill strip and the receipt, `departed` when the clock
 * ran out or when the player collapsed holding the evidence — so a fixed paragraph is bound to be wrong for some
 * of them. `endings/<id>/README.md` may add `passages:` after its body:
 *
 *   passages:
 *     - text: 一段总是出现的话。
 *     - group: log                                  # one of a group: the first that holds, in order
 *       when: 'has("player/logbook-page.md")'
 *       text: 那页日志……
 *     - group: log
 *       text: 日志页再也没有找到。                  # no `when`: the group's fallback
 *
 * The card reads the body, then each passage in order: one without `when` always; one with `when` only when the
 * condition (the trigger grammar: `has()`, `player.x`, `world.x`, `<character>.x`, `clock.left`) holds as the card
 * is shown — the story has ended, so nothing moves any more. In a `group` only the first passage that qualifies is
 * read. A `when` that does not parse or cannot be decided hides its passage (fail closed). Characters never read
 * endings (rules/character-view.ts), so these conditions are the writer's only.
 */
import { parseFrontmatter } from '../schemas/frontmatter.js';
import type { WorldStore } from '../store/world-store.js';
import { collectHasPaths, evaluateCondition, type ConditionAst } from '../commands/condition.js';
import { loadTriggerWorld, parseTriggerCondition, snapshotTriggerWorld } from '../commands/world-triggers.js';

export interface EndingPassage {
  text: string;
  when?: string;
  group?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Pure: the declared passages, malformed entries dropped (with a reason each). */
export function parseEndingPassages(frontmatter: Record<string, unknown> | null | undefined): { passages: EndingPassage[]; errors: string[] } {
  const raw = frontmatter?.passages;
  const errors: string[] = [];
  if (raw === undefined) return { passages: [], errors };
  if (!Array.isArray(raw)) return { passages: [], errors: ['passages must be a list'] };
  const passages: EndingPassage[] = [];
  raw.forEach((entry, i) => {
    if (!isRecord(entry) || typeof entry.text !== 'string' || entry.text.trim() === '') {
      errors.push(`passages[${i}] needs a non-empty "text"`);
      return;
    }
    if (entry.when !== undefined && (typeof entry.when !== 'string' || entry.when.trim() === '')) {
      errors.push(`passages[${i}].when must be a condition string`);
      return;
    }
    if (entry.group !== undefined && (typeof entry.group !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(entry.group))) {
      errors.push(`passages[${i}].group must be a short id`);
      return;
    }
    passages.push({ text: entry.text.trim(), ...(entry.when ? { when: entry.when } : {}), ...(entry.group ? { group: entry.group } : {}) });
  });
  return { passages, errors };
}

/** Pure: the body followed by the passages that hold, paragraphs separated by a blank line. */
export function composeEndingText(body: string, passages: readonly EndingPassage[], holds: (when: string) => boolean): string {
  const out: string[] = [];
  if (body.trim()) out.push(body.trim());
  const settled = new Set<string>();
  for (const p of passages) {
    if (p.group && settled.has(p.group)) continue;
    if (p.when !== undefined && !holds(p.when)) continue;
    if (p.group) settled.add(p.group);
    out.push(p.text);
  }
  return out.join('\n\n');
}

/** The ending card's text and picture, read from the save as it stands now. Missing file → empty text. */
export async function endingTextOf(store: WorldStore, path: string): Promise<{ body: string; bg: string | null }> {
  if ((await store.statKind(path)) !== 'file') return { body: '', bg: null };
  const page = parseFrontmatter(await store.readFile(path));
  const fm = (page.frontmatter ?? {}) as Record<string, unknown>;
  const bg = typeof fm.bg === 'string' ? fm.bg : null;
  const { passages } = parseEndingPassages(fm);
  if (!passages.some((p) => p.when !== undefined)) return { body: composeEndingText(page.body, passages, () => false), bg };

  const world = await loadTriggerWorld(store);
  const ids = world?.characterIds ?? [];
  const parsed = new Map<string, ConditionAst | null>();
  for (const p of passages) {
    if (p.when === undefined || parsed.has(p.when)) continue;
    const r = parseTriggerCondition(p.when, ids);
    parsed.set(p.when, r.ok ? r.value : null);
  }
  const snap = world ? await snapshotTriggerWorld(store, world) : null;
  const values = snap?.values ?? new Map();
  const paths = new Map(snap?.paths ?? []);
  for (const ast of parsed.values()) {
    if (!ast) continue;
    for (const p of collectHasPaths(ast)) if (!paths.has(p)) paths.set(p, await store.statKind(p));
  }
  const holds = (when: string): boolean => {
    const ast = parsed.get(when);
    if (!ast) return false;
    const r = evaluateCondition(ast, { values, paths });
    return r.ok && r.value === true;
  };
  return { body: composeEndingText(page.body, passages, holds), bg };
}
