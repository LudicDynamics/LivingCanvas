/**
 * `GET /api/ambient` — the active world's ambient-life data
 *: every `ambient/<id>.json` at the world root,
 * sanitised, keyed by id. Read-only; nothing here is a world fact, so there is
 * no event, no action layer and no agent involvement. A world without the
 * folder answers `{ entries: {} }` and the client falls back to wordless emotes.
 */
import { Router } from 'express';
import { AMBIENT_DIR, ambientIdOf, sanitizeAmbientEntry, type AmbientEntry, type LocalWorldStore } from '@airp/shared';

export interface AmbientRouterDeps {
  getStore(): LocalWorldStore | null;
}

/** Bounded read: a folder this large is not ambient flavor any more. */
const MAX_FILES = 64;
const MAX_BYTES = 32 * 1024;

export async function readAmbientEntries(store: LocalWorldStore): Promise<Record<string, AmbientEntry>> {
  if ((await store.statKind(AMBIENT_DIR)) !== 'dir') return {};
  const entries: Record<string, AmbientEntry> = {};
  const files = (await store.listFiles(AMBIENT_DIR)).sort().slice(0, MAX_FILES);
  for (const file of files) {
    const id = ambientIdOf(file);
    if (!id) continue;
    try {
      const text = await store.readFile(file);
      if (text.length > MAX_BYTES) continue;
      const entry = sanitizeAmbientEntry(JSON.parse(text));
      if (entry) entries[id] = entry;
    } catch {
      // A broken file silences only that person; check:worlds reports it for templates.
    }
  }
  return entries;
}

export function createAmbientRouter(deps: AmbientRouterDeps): Router {
  const router = Router();
  router.get('/ambient', async (_req, res) => {
    const store = deps.getStore();
    if (!store) {
      res.status(409).json({ ok: false, code: 'no_active_world', error: 'Load a world first.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    try {
      res.json({ ok: true, entries: await readAmbientEntries(store) });
    } catch (err) {
      res.json({ ok: true, entries: {}, warning: err instanceof Error ? err.message : String(err) });
    }
  });
  return router;
}
