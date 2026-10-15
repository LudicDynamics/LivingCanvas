/**
 * 成就 — the 个人页面's badges. ONE data file: add an
 * entry here and the page shows it (locked as a silhouette with its hint until
 * `progress` reaches `goal`).
 *
 * A basic set only: simple, clearly understandable, derived
 * from what the game already records — endings, the 复盘, CGs shown, ratings,
 * favorites, the workshop, daily claims. Badges only: no credits. The task /
 * reward system (claimable credits) comes later and lives beside this list, not
 * in it.
 *
 * `t()` below only marks the strings for the i18n gate (pnpm check:i18n); the
 * page translates them with the real `t`.
 */
const t = (key: string): string => key;

/** What the achievements are computed from (lib/profile-model.ts builds it). */
export interface AchievementStats {
  /** Worlds (per world key: editions of one world count once) with any save or playthrough. */
  worldsEntered: number;
  /** Distinct endings reached (world key + ending id). */
  endingsReached: number;
  /** Worlds with at least one ending reached. */
  worldsWithEnding: number;
  /** The most complete world's endings: reached / total (total 0 = no world with endings known). */
  bestEndings: { reached: number; total: number };
  /** Mysteries unlocked in the best 复盘 so far, and that world's count. */
  bestDebrief: { unlocked: number; total: number };
  /** Distinct CGs seen (world key + picture). */
  cgsSeen: number;
  /** The most complete world's gallery: seen / total. */
  bestGallery: { seen: number; total: number };
  reviews: number;
  favorites: number;
  workshopMade: number;
  workshopPublished: number;
  /** Longest run of consecutive days with a daily claim (wallet entries; signed in only). */
  claimStreak: number;
}

export type AchievementIcon = 'door' | 'flag' | 'map' | 'crown' | 'key' | 'image' | 'gallery' | 'star' | 'heart' | 'pen' | 'globe' | 'calendar';

export interface AchievementDef {
  id: string;
  icon: AchievementIcon;
  title: string;
  /** Shown under the locked silhouette: how to get it (never a spoiler). */
  hint: string;
  goal: number;
  /** Progress towards `goal` (clamped by the page). */
  progress: (s: AchievementStats) => number;
}

/** Ratio progress: full only when the best world is complete (and has something to complete). */
const complete = (done: number, total: number) => (total > 0 && done >= total ? 1 : 0);

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-world', icon: 'door', title: t('First steps'), hint: t('Enter any world.'), goal: 1, progress: (s) => s.worldsEntered },
  { id: 'first-ending', icon: 'flag', title: t('An ending'), hint: t('Reach an ending in any world.'), goal: 1, progress: (s) => s.endingsReached },
  { id: 'endings-three-worlds', icon: 'map', title: t('Many roads'), hint: t('Reach an ending in three different worlds.'), goal: 3, progress: (s) => s.worldsWithEnding },
  { id: 'all-endings-one-world', icon: 'crown', title: t('Every ending'), hint: t('Reach every ending of one world.'), goal: 1, progress: (s) => complete(s.bestEndings.reached, s.bestEndings.total) },
  { id: 'first-secret', icon: 'key', title: t('A secret uncovered'), hint: t('Unlock a secret in a debrief after an ending.'), goal: 1, progress: (s) => s.bestDebrief.unlocked },
  { id: 'first-cg', icon: 'image', title: t('A picture to keep'), hint: t('See a CG in any world.'), goal: 1, progress: (s) => s.cgsSeen },
  { id: 'all-cgs-one-world', icon: 'gallery', title: t('Full gallery'), hint: t('See every CG of one world.'), goal: 1, progress: (s) => complete(s.bestGallery.seen, s.bestGallery.total) },
  { id: 'first-review', icon: 'star', title: t('A critic'), hint: t('Rate a world.'), goal: 1, progress: (s) => s.reviews },
  { id: 'first-favorite', icon: 'heart', title: t('A favorite'), hint: t('Add a world to your favorites.'), goal: 1, progress: (s) => s.favorites },
  { id: 'first-workshop-world', icon: 'pen', title: t('Worldmaker'), hint: t('Create a world in the workshop.'), goal: 1, progress: (s) => s.workshopMade },
  { id: 'first-published-world', icon: 'globe', title: t('Shared with everyone'), hint: t('Publish a world you made.'), goal: 1, progress: (s) => s.workshopPublished },
  { id: 'claim-streak-7', icon: 'calendar', title: t('A week of visits'), hint: t('Claim the daily credits seven days in a row.'), goal: 7, progress: (s) => s.claimStreak },
];

export interface AchievementState {
  def: AchievementDef;
  value: number;
  earned: boolean;
  /** When it was first seen earned (journal), ISO; null while locked. */
  earnedAt: string | null;
}

/** Every achievement against these stats; `earnedAt` from what the journal remembers. */
export function evaluateAchievements(stats: AchievementStats, earnedAt: Readonly<Record<string, string>> = {}): AchievementState[] {
  return ACHIEVEMENTS.map((def) => {
    const value = Math.max(0, Math.min(def.goal, Math.floor(def.progress(stats) || 0)));
    const remembered = earnedAt[def.id] ?? null;
    // once earned, always earned: a save deleted or replayed later does not take a badge back
    const earned = value >= def.goal || remembered !== null;
    return { def, value: earned ? def.goal : value, earned, earnedAt: earned ? remembered : null };
  });
}
