/**
 * 方案主视觉: the small key visual per tier in the account
 * panel's plans sheet (PlansPreview.tsx). The same art as billing's plan cards
 * (the Worldlines platform services/billing/src/plan-art.mjs), bundled here as our
 * own copies under src/assets/plans/<art>/<crop>.webp (WebP q80, no metadata;
 * panel ≤960 wide, square 512 — the sheet is at most 360px wide).
 *
 * The manifest is whatever files exist (plan-art-files.ts globs the folder at
 * build time): a crop falls back panel → wide → square, cropped to the art's
 * focal point, so a dropped-in or removed crop needs no code change. Since
 * 2026-10-05 every tier has its own panel; since 2026-10-06 the three defaults
 * are the aligned c04 set (one neon city at three heights).
 * Kept free of Vite so node tests import it.
 *
 * 卡面角色: the player picks the character on the cards —
 * 默认 / 男性角色 / 女性角色 / 随机 (lib/plan-look.ts), never inferred. A look
 * lives in <art>/<look>/panel.webp (m | f); the files directly in <art>/ are
 * the default look (PLAN_ART_DEFAULT_LOOK: free a boy, traveler a woman, voyager
 * a man). A look falls back crop by crop inside its folder, then to the default
 * files — never a blank block. Same layout as billing's public/plans/.
 */
import type { PlanId } from './plans.js';

export type PlanArtKey = 'free' | 'traveler' | 'voyager';
export type PlanArtCrop = 'panel' | 'card' | 'square' | 'wide';
/** A look with a folder of its own (男性角色 / 女性角色). */
export type PlanArtLook = 'm' | 'f';
/** The player's preference: '' = 默认, r = 随机 (drawn per art, once per page view). */
export type PlanLookPref = '' | PlanArtLook | 'r';

/** What the files directly in <art>/ show: picking this look is the same as the default. Same as billing's DEFAULT_LOOK. */
export const PLAN_ART_DEFAULT_LOOK: Record<PlanArtKey, PlanArtLook> = { free: 'm', traveler: 'f', voyager: 'm' };

/** Plan ids stay free / story / vivid; the art folders carry the display names. */
export const PLAN_ART_KEY: Record<PlanId, PlanArtKey> = { free: 'free', story: 'traveler', vivid: 'voyager' };

/** Where the face / emblem is, for a fallback crop (CSS object-position). Same values as billing's FOCAL. */
export const PLAN_ART_FOCAL: Record<string, string> = {
  // the defaults: the face on the c04 card (its top square is the square; 2026-10-06)
  free: '40% 18%', traveler: '41% 14%', voyager: '35% 18%',
  // the looks: full-figure daytime illustrations, face high (billing's FOCAL["free/f"] …)
  'free/f': '50% 14%', 'traveler/m': '44% 10%', 'voyager/f': '52% 12%',
};

export const PLAN_ART_FALLBACK: Record<PlanArtCrop, PlanArtCrop[]> = {
  panel: ['panel', 'wide', 'square'],
  card: ['card', 'square', 'wide'],
  square: ['square', 'card'],
  wide: ['wide', 'panel', 'square'],
};

/** look: the look actually shown ('' = the default files). */
export interface PlanArt { url: string; crop: PlanArtCrop; exact: boolean; position: string; look: '' | PlanArtLook }

const FILE = /\/plans\/([a-z0-9-]+(?:\/[mf])?)\/([a-z0-9-]+)\.webp$/;

/**
 * The best bundled file for a plan + crop (+ look: m | f, already drawn for 随机), or null when there is none (the block
 * then shows no art). A look other than the art's default tries <art>/<look>/ first, then the default files.
 */
export function resolvePlanArt(files: Record<string, string>, plan: PlanId, crop: PlanArtCrop = 'panel', look: '' | PlanArtLook = ''): PlanArt | null {
  const art = PLAN_ART_KEY[plan];
  const keys = (look === 'm' || look === 'f') && look !== PLAN_ART_DEFAULT_LOOK[art] ? [`${art}/${look}`, art] : [art];
  const have = new Map<string, string>();
  for (const [path, url] of Object.entries(files)) {
    const m = FILE.exec(path);
    if (m && keys.includes(m[1]) && typeof url === 'string') have.set(`${m[1]}:${m[2]}`, url);
  }
  for (const key of keys) {
    for (const c of PLAN_ART_FALLBACK[crop]) {
      const url = have.get(`${key}:${c}`);
      const focal = PLAN_ART_FOCAL[key] ?? PLAN_ART_FOCAL[art];
      if (url) return { url, crop: c, exact: c === crop, position: c === crop && key === art ? '50% 50%' : focal, look: key === art ? '' : (look as PlanArtLook) };
    }
  }
  return null;
}

/** A preference → the look for one art: r draws m / f (rand() < .5 → m); '' stays the default. */
export function drawPlanLook(pref: PlanLookPref, rand: () => number = Math.random): '' | PlanArtLook {
  if (pref === 'r') return rand() < 0.5 ? 'm' : 'f';
  return pref === 'm' || pref === 'f' ? pref : '';
}
