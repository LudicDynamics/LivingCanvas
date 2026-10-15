/**
 * Character sheets. Read-only on the page:
 * `GET /api/world/sheets` already resolved labels, percentages and modifiers;
 * this module only reads it fail-soft and says the few lines around it. No HUD —
 * the sheet opens from the player's avatar panel or a character's modal.
 */
import { useEffect, useState } from 'react';
import { checkLine, checkSpec, tierLabel, type SkillSystem } from '@airp/shared/skills';

export interface SheetSkillView {
  id: string;
  label: string;
  desc?: string;
  value?: number;
  half?: number;
  fifth?: number;
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
  /** A character's name. */
  name?: string;
  skills: SheetSkillView[];
}
/** The inspiration roll as the sheet shows it. */
export interface InspirationView {
  label: string;
  system: SkillSystem;
  value: number;
  /** Can it be rolled now? */
  ready: boolean;
  /** Rolls left this time round. */
  left: number;
  /** When not ready: how long, and in what. */
  wait?: { n: number; unit: 'clock' | 'actions' };
}
export interface WorldSheets {
  rules: { system: SkillSystem; label: string; sanity: boolean; characterChecks: boolean; proficiency: number } | null;
  player: SheetView | null;
  characters: Record<string, SheetView>;
  /** Characters with the player now (their `assist` skills count). */
  with: string[];
  inspiration: InspirationView | null;
}

export const EMPTY_SHEETS: WorldSheets = { rules: null, player: null, characters: {}, with: [], inspiration: null };

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function sheetOf(raw: unknown): SheetView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const skills = Array.isArray(r.skills)
    ? r.skills.flatMap((s): SheetSkillView[] => {
        if (!s || typeof s !== 'object') return [];
        const o = s as Record<string, unknown>;
        if (typeof o.id !== 'string' || typeof o.label !== 'string' || !o.label) return [];
        return [{
          id: o.id,
          label: o.label,
          ...(typeof o.desc === 'string' ? { desc: o.desc } : {}),
          ...(num(o.value) !== undefined ? { value: num(o.value), half: num(o.half), fifth: num(o.fifth) } : {}),
          ...(num(o.modifier) !== undefined ? { modifier: num(o.modifier) } : {}),
          ...(typeof o.ability === 'string' ? { ability: o.ability } : {}),
          ...(o.proficient === true ? { proficient: true } : {}),
          ...(o.expertise === true ? { expertise: true } : {}),
          ...(o.marked === true ? { marked: true } : {}),
          ...(o.assist === true ? { assist: true } : {}),
        }];
      })
    : [];
  const abilities = Array.isArray(r.abilities)
    ? r.abilities.flatMap((a) => {
        const o = (a ?? {}) as Record<string, unknown>;
        return typeof o.id === 'string' && typeof o.label === 'string' && num(o.modifier) !== undefined ? [{ id: o.id, label: o.label, modifier: num(o.modifier)! }] : [];
      })
    : undefined;
  if (skills.length === 0 && !abilities?.length) return null;
  return { ...(abilities ? { abilities } : {}), ...(typeof r.name === 'string' && r.name ? { name: r.name } : {}), skills };
}

/** The route's `inspiration` (an engine InspirationStatus), fail-soft; null when off or malformed. */
export function inspirationOf(raw: unknown): InspirationView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (r.enabled !== true || (r.system !== 'coc' && r.system !== 'dnd') || typeof r.label !== 'string' || num(r.value) === undefined) return null;
  const gate = r.gate && typeof r.gate === 'object' ? r.gate : {};
  const left = num(gate.left) ?? 0;
  const ready = gate.ok === true;
  const wait = !ready && gate.reason === 'cooldown' && num(gate.wait) !== undefined && (gate.unit === 'clock' || gate.unit === 'actions')
    ? { n: num(gate.wait)!, unit: gate.unit as 'clock' | 'actions' }
    : undefined;
  return { label: r.label, system: r.system, value: num(r.value)!, ready, left, ...(wait ? { wait } : {}) };
}

/** Fail-soft read of the route body: anything malformed reads as "no sheets". */
export function normalizeSheets(body: unknown): WorldSheets {
  const b = (body ?? {}) as Record<string, any>;
  const r = b.rules;
  if (!r || (r.system !== 'coc' && r.system !== 'dnd')) return EMPTY_SHEETS;
  const characters: Record<string, SheetView> = {};
  if (b.characters && typeof b.characters === 'object') {
    for (const [id, raw] of Object.entries(b.characters as Record<string, unknown>)) {
      const sheet = sheetOf(raw);
      if (sheet) characters[id] = sheet;
    }
  }
  return {
    rules: {
      system: r.system,
      label: typeof r.label === 'string' ? r.label : r.system,
      sanity: r.sanity === true,
      characterChecks: r.characterChecks !== false,
      proficiency: num(r.proficiency) ?? 2,
    },
    player: sheetOf(b.player),
    characters,
    with: Array.isArray(b.with) ? b.with.filter((id: unknown): id is string => typeof id === 'string' && Object.hasOwn(characters, id)) : [],
    inspiration: inspirationOf(b.inspiration),
  };
}

/** The companions with the player who lend at least one skill, with what they lend. */
export function lendersOf(sheets: WorldSheets): Array<{ id: string; name: string; sheet: SheetView; lends: SheetSkillView[] }> {
  return sheets.with.flatMap((id) => {
    const sheet = sheets.characters[id];
    if (!sheet) return [];
    return [{ id, name: sheet.name ?? id, sheet, lends: sheet.skills.filter((s) => s.assist) }];
  });
}

export async function fetchWorldSheets(layer?: string | null): Promise<WorldSheets> {
  const res = await fetch(layer ? `/api/world/sheets?layer=${encodeURIComponent(layer)}` : '/api/world/sheets');
  if (!res.ok) return EMPTY_SHEETS;
  return normalizeSheets(await res.json());
}

/** Re-read on every world load and on the forwarded world events (a mark lands as an edit of player/README.md). */
export function useWorldSheets(worldKey: string): WorldSheets {
  const [sheets, setSheets] = useState<WorldSheets>(EMPTY_SHEETS);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void fetchWorldSheets().then((next) => { if (live) setSheets(next); }).catch(() => undefined);
    };
    setSheets(EMPTY_SHEETS);
    if (worldKey) refresh();
    window.addEventListener('airp:world-event', refresh);
    return () => {
      live = false;
      window.removeEventListener('airp:world-event', refresh);
    };
  }, [worldKey]);
  return sheets;
}

/** "60%" / "+5". */
export function skillScore(system: SkillSystem, skill: SheetSkillView): string {
  if (system === 'coc') return `${skill.value ?? 0}%`;
  const m = skill.modifier ?? 0;
  return m >= 0 ? `+${m}` : String(m);
}

/** A check card's line ("Spot Hidden 60%", "Arcana +5 · DC 15") from its `skill_check` block; null when it is not one. */
export function skillCardLine(block: unknown, locale: string): string | null {
  if (!block || typeof block !== 'object') return null;
  const b = block as Record<string, unknown>;
  if ((b.system !== 'coc' && b.system !== 'dnd') || typeof b.label !== 'string') return null;
  const spec = checkSpec({ system: b.system, value: Number(b.value) || 0, difficulty: b.difficulty, advantage: b.advantage });
  return checkLine(spec, b.label, locale);
}

/** The roll's tier in the PAGE's language (the server's `tierLabel` is the world's). */
export function skillTierText(skill: { system?: unknown; tier?: unknown; tierLabel?: unknown } | undefined | null, locale: string): string | null {
  if (!skill || (skill.system !== 'coc' && skill.system !== 'dnd') || typeof skill.tier !== 'string') return null;
  return tierLabel(skill.system, skill.tier, locale);
}
