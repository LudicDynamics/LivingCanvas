import { useEffect, useState } from 'react';

/**
 * 日志 (platform/log v5) for one world: its latest three published entries (platform livingcanvas, scope world:<id>,
 * surface world), read through this app's server (/api/account-data/logs?world=<id>, which asks data
 * GET /v1/public/logs with ETag / 304). Shown as 「更新记录」 on the world intro card, at most five minutes old.
 * Signed out works too; offline / no data service = an empty list, never an error.
 */
export interface WorldLog { id: string; category: string; title: Record<string, string>; body: Record<string, string>; publishedAt: string; links: Array<{ url: string; label?: string }>; tags?: string[]; imageUrl?: string }

const TTL_MS = 5 * 60_000;
const WORLD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const cache = new Map<string, { at: number; logs: WorldLog[] }>();

export async function fetchWorldLogs(worldId: string, env: { fetch: typeof fetch; now: () => number } = { fetch: (...a) => fetch(...a), now: Date.now }): Promise<WorldLog[]> {
  if (!WORLD.test(worldId)) return [];
  const hit = cache.get(worldId);
  if (hit && env.now() - hit.at < TTL_MS) return hit.logs;
  try {
    const res = await env.fetch(`/api/account-data/logs?world=${encodeURIComponent(worldId)}`);
    const json = await res.json().catch(() => null);
    const logs: WorldLog[] = json?.ok && Array.isArray(json.logs) ? json.logs.slice(0, 3) : [];
    cache.set(worldId, { at: env.now(), logs });
    return logs;
  } catch {
    return [];
  }
}
export const clearWorldLogs = () => cache.clear();

export function useWorldLogs(worldId: string | null | undefined): WorldLog[] {
  const [logs, setLogs] = useState<WorldLog[]>(() => (worldId ? cache.get(worldId)?.logs ?? [] : []));
  useEffect(() => {
    if (!worldId) return;
    let live = true;
    void fetchWorldLogs(worldId).then(l => { if (live) setLogs(l); });
    return () => { live = false; };
  }, [worldId]);
  return logs;
}
