/**
 * The guest trial: on canvas.worldlines.gg one world plays
 * without signing in — 末班车 (last-train) in its four editions, shipped with the static site, and the
 * newcomer tutorial world at the same time. A guest gets GUEST_TRIAL_CREDITS on an anonymous session
 * (identity POST /v1/guest, billing POST /v1/claims/worldlines/guest-trial; once per device AND per
 * network); every other world needs an account. The ids here must match ai.worldlines.gg
 * API_GUEST_WORLDS (the Worldlines platform services/ai).
 */
export const GUEST_TRIAL_EDITION = 'last-train';
export const GUEST_TRIAL_WORLDS: readonly string[] = ['last-train', 'last-train-zh', 'last-train-jp', 'last-train-ko'];
/**
 * The first-run prologue: 末班车 · 序章, a separate edition family played as a
 * guest straight from the first-run screen. Trial worlds too — but shipped with the site only when the
 * build turns the first-run experience on (VITE_AIRP_FIRST_RUN=1, deploy/canvas/assemble-browser.mjs),
 * and ai.worldlines.gg API_GUEST_WORLDS must list them before that build goes live.
 */
export const GUEST_PROLOGUE_WORLDS: readonly string[] = ['last-train-prologue', 'last-train-prologue-zh', 'last-train-prologue-jp', 'last-train-prologue-ko'];
/** Credits a guest gets; the newcomer gift an account gets after signing in. */
export const GUEST_TRIAL_CREDITS = 200;
export const NEWCOMER_GIFT_CREDITS = 500;
/** 「试玩积分快用完」 once this many credits or fewer are left. */
export const GUEST_TRIAL_LOW_CREDITS = 40;

/** Is this a trial world's id (template edition id / shelf group id / X-Worldlines-World)? */
export function isGuestTrialWorldId(id: unknown): boolean {
  return typeof id === 'string' && (GUEST_TRIAL_WORLDS.includes(id) || GUEST_PROLOGUE_WORLDS.includes(id));
}

/** Is this a trial edition's template path (`templates/<id>`)? Saves are recognised by their shelf group instead. */
export function isGuestTrialTemplatePath(worldPath: unknown): boolean {
  if (typeof worldPath !== 'string') return false;
  const m = /^(?:\.\/)?templates\/([A-Za-z0-9][A-Za-z0-9_-]*)\/?$/.exec(worldPath);
  return !!m && isGuestTrialWorldId(m[1]);
}
