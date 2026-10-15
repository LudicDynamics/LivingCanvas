/**
 * 卡面角色: which character the plan key visuals show —
 * 默认 ('') / 男性角色 (m) / 女性角色 (f) / 随机 (r). The player's own pick,
 * never inferred from anything. Kept on this device (localStorage) and in the
 * account's synced settings (lib/account-data-app.ts → data service
 * livingcanvas `setting.planLook`, manifest v10), so it follows the account
 * and still works signed out. Passed to the billing site as ?look= on its
 * links (lib/plans.ts billingLinks), which remembers it in its own cookie.
 *
 * 随机 is drawn once per art per page view (planLookFor): the art does not
 * flicker while the page is open, and a reload may draw again.
 * Kept free of React / Vite so node tests import it.
 */
import { announcePrefsChanged } from './prefs-events.js';
import { PLAN_ART_KEY, drawPlanLook, type PlanArtLook, type PlanLookPref } from './plan-art.js';
import type { PlanId } from './plans.js';

export const PLAN_LOOK_KEY = 'airp:plan-look';
export const PLAN_LOOK_PREFS: readonly PlanLookPref[] = ['', 'm', 'f', 'r'];

/** A stored / synced value → a preference; anything else = 默认. */
export const parsePlanLook = (v: unknown): PlanLookPref => (v === 'm' || v === 'f' || v === 'r' ? v : '');

const storage = (): Storage | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

let current: PlanLookPref | null = null;
const listeners = new Set<() => void>();

export function planLookPref(): PlanLookPref {
  if (current === null) {
    let raw: string | null = null;
    try { raw = storage()?.getItem(PLAN_LOOK_KEY) ?? null; } catch { /* blocked */ }
    current = parsePlanLook(raw);
  }
  return current;
}

/** Set the preference (from the switcher, or a synced one with announce=false). */
export function setPlanLookPref(next: unknown, { announce = true }: { announce?: boolean } = {}): void {
  const v = parsePlanLook(next);
  if (v === planLookPref()) return;
  current = v;
  try {
    const s = storage();
    if (v) s?.setItem(PLAN_LOOK_KEY, v);
    else s?.removeItem(PLAN_LOOK_KEY);
  } catch { /* storage blocked: memory only */ }
  for (const fn of listeners) fn();
  if (announce) announcePrefsChanged();
}

export function subscribePlanLook(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 随机's draws for this page view, per art (cleared only by a reload). */
const draws = new Map<string, PlanArtLook>();

/** The look to show for a plan under a preference: 随机 draws once per art per page view. */
export function planLookFor(plan: PlanId, pref: PlanLookPref, rand: () => number = Math.random): '' | PlanArtLook {
  if (pref !== 'r') return drawPlanLook(pref);
  const art = PLAN_ART_KEY[plan];
  let got = draws.get(art);
  if (!got) {
    got = drawPlanLook('r', rand) as PlanArtLook;
    draws.set(art, got);
  }
  return got;
}

/** Tests only: forget the memory copy and the draws. */
export function resetPlanLookForTests(): void {
  current = null;
  draws.clear();
  listeners.clear();
}
