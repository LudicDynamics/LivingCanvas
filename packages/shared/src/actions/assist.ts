/**
 * Companion specialties.
 *
 * A character's sheet may mark a skill `assist: true`. While that character is
 * WITH the player — following, or standing on the player's page — it rolls that
 * skill for the player whenever it is better at it than the player (or the
 * player does not have the skill at all). The player's own check cards still
 * wait for the player's click; only the number on them is the companion's.
 * Passive checks (actions/passive.ts) pick their roller the same way.
 *
 * Read-only; no event. The roll itself stays where it was (rollDice / passive).
 */
import { dndSkillModifier, type WorldRules } from '../rules/skills.js';
import type { WorldStore } from '../store/world-store.js';
import { readSheet, type WorldRulesContext } from './skill-cards.js';

export interface SkillRoller {
  /** `player` or the assisting character's id. */
  actor: string;
  /** The character's name (the player: ''). */
  name: string;
  /** The skill's label on that sheet. */
  label: string;
  /** coc: the %; dnd: the modifier. */
  value: number;
}

/** Is this character with the player on `page` (following, or standing there; never placed → its home)? */
export async function characterWithPlayer(store: WorldStore, id: string, page: string): Promise<boolean> {
  const presence = store.getPresenceOf(id);
  if (presence) return presence.following || presence.layer === page;
  const manifest = await store.getManifest();
  const config = manifest.characters?.find((c) => c.id === id);
  return (config?.home ?? 'map') === page;
}

function scoreOf(rules: WorldRules, sheet: Parameters<typeof dndSkillModifier>[0], skill: Parameters<typeof dndSkillModifier>[1]): number {
  return rules.system === 'coc' ? skill.value ?? 1 : dndSkillModifier(sheet, skill, rules.proficiency);
}

/** The characters with the player on `page` who lend this skill (`assist: true`), best first. */
export async function assistersOf(store: WorldStore, w: WorldRulesContext, skillId: string, page: string): Promise<SkillRoller[]> {
  if (skillId === 'sanity') return [];
  const manifest = await store.getManifest();
  const out: SkillRoller[] = [];
  for (const c of manifest.characters ?? []) {
    const loaded = await readSheet(store, c.id, w.rules, w.locale).catch(() => null);
    const skill = loaded?.sheet.skills.find((s) => s.id === skillId && s.assist === true);
    if (!loaded || !skill) continue;
    if (!(await characterWithPlayer(store, c.id, page))) continue;
    out.push({ actor: c.id, name: c.name ?? c.id, label: skill.label, value: scoreOf(w.rules, loaded.sheet, skill) });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** The player's own number for a skill, or null when the sheet does not have it. */
export async function playerSkillOf(store: WorldStore, w: WorldRulesContext, skillId: string): Promise<SkillRoller | null> {
  const loaded = await readSheet(store, 'player', w.rules, w.locale).catch(() => null);
  const skill = loaded?.sheet.skills.find((s) => s.id === skillId);
  if (!loaded || !skill) return null;
  return { actor: 'player', name: '', label: skill.label, value: scoreOf(w.rules, loaded.sheet, skill) };
}

/** Pure: the player rolls, unless a helper is strictly better (ties stay the player's). Null when nobody has it. */
export function bestRoller(player: SkillRoller | null, helpers: readonly SkillRoller[]): SkillRoller | null {
  const best = helpers.reduce<SkillRoller | null>((acc, h) => (!acc || h.value > acc.value ? h : acc), null);
  if (!player) return best;
  return best && best.value > player.value ? best : player;
}

/** Who rolls `skillId` for the player on `page` right now. */
export async function rollerFor(store: WorldStore, w: WorldRulesContext, skillId: string, page: string): Promise<SkillRoller | null> {
  return bestRoller(await playerSkillOf(store, w, skillId), await assistersOf(store, w, skillId, page));
}
