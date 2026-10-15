/**
 * A world that would not open (POST /api/worlds/load), in words the player can act on — pure, tested in
 * apps/web/test/world-load-error.test.mjs. The in-tab server (apps/browser-runtime/src/worlds.ts
 * `worldLoadFailure`) answers a failed download with a code:
 *   `signed_out`  (401) the world needs an account → the sign-in card, then the open carries on;
 *   `network`     (503) no answer from the network → try again;
 *   `world_files` (502) the files that came back were not the world's → try again later / report a problem.
 * Anything else keeps the server's own sentence (it was the raw `POST /api/worlds/load -> 502 {…}` before).
 */
export type WorldLoadFailure = { kind: 'sign-in' | 'retry' | 'other'; text: string };

/** messages.json keys. */
export const WORLD_LOAD_TEXT = {
  signedOut: 'Sign in to open this world. It opens right after.',
  network: 'Could not reach the world files. Check your connection and try again.',
  files: 'This world’s files did not download correctly. Try again in a moment; if it keeps happening, report a problem.',
  fallback: 'Could not load that world',
} as const;

export function worldLoadFailureOf(error: unknown, translate: (key: string) => string = (k) => k): WorldLoadFailure {
  const e = error as { status?: unknown; payload?: { code?: unknown; error?: unknown } | null } | null;
  const code = typeof e?.payload?.code === 'string' ? e.payload.code : null;
  if (code === 'signed_out') return { kind: 'sign-in', text: translate(WORLD_LOAD_TEXT.signedOut) };
  if (code === 'network') return { kind: 'retry', text: translate(WORLD_LOAD_TEXT.network) };
  if (code === 'world_files') return { kind: 'retry', text: translate(WORLD_LOAD_TEXT.files) };
  if (typeof e?.payload?.error === 'string' && e.payload.error) return { kind: 'other', text: e.payload.error };
  return { kind: 'other', text: translate(WORLD_LOAD_TEXT.fallback) };
}
