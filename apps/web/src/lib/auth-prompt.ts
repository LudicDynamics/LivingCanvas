/**
 * Browser mode: the Worker says `auth-required` on EVERY model call it cannot
 * sign (the gateway has no usable token). Opening the account popup each time
 * re-opened it right after the player pressed × — the popup looked stuck
 *. Ask once, then stay
 * quiet for a while; the player's own clicks (play, 账号) still open it.
 */
export const AUTH_PROMPT_QUIET_MS = 60_000;

export function createAuthPrompt(open: () => void, now: () => number = () => Date.now()): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const t = now();
    if (t - last < AUTH_PROMPT_QUIET_MS) return false;
    last = t;
    open();
    return true;
  };
}
