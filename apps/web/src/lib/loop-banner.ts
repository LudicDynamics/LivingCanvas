/**
 * A `loop_reset` world event → what the 「第 N 轮」
 * banner shows, or null. A reset replayed on reconnect (older than a minute)
 * is not re-shown.
 */
export const LOOP_BANNER_FRESH_MS = 60_000;

export function loopOf(detail: unknown, now = Date.now()): { id: string; loop: number } | null {
  const ev = detail as { id?: unknown; createdAt?: unknown; detail?: { loop?: unknown } } | null;
  if (!ev || typeof ev.id !== 'string' || typeof ev.detail?.loop !== 'number') return null;
  if (typeof ev.createdAt === 'string' && now - Date.parse(ev.createdAt) > LOOP_BANNER_FRESH_MS) return null;
  return { id: ev.id, loop: ev.detail.loop };
}
