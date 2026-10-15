/**
 * `GET /api/world/stream?before=<cursor>&limit=<n>` — the message drawer's history.
 *
 * The newest `limit` entries (default 80, at most 200) strictly before `before`, oldest first, plus `more` /
 * `next` for the page above. Read-only; built by engine/stream-history.ts from what the save already keeps.
 * `savePath` names the save it was read from, so a page that switched saves meanwhile can drop the answer.
 */
import { Router } from 'express';
import type { LocalWorldStore } from '@airp/shared';
import { readStreamHistory } from '../engine/stream-history.js';

export function createStreamRouter(getStore: () => LocalWorldStore | null): Router {
  const router = Router();
  router.get('/world/stream', async (req, res) => {
    const store = getStore();
    if (!store) { res.status(409).json({ ok: false, code: 'no_active_world', error: 'Load a world first.' }); return; }
    const before = typeof req.query.before === 'string' && req.query.before !== '' ? req.query.before : null;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
      res.status(400).json({ ok: false, code: 'invalid_argument', error: 'limit must be a positive integer' });
      return;
    }
    try {
      const page = await readStreamHistory(store, { before, limit });
      // The save may have been switched while this was read; the page checks `savePath` too.
      if (getStore() !== store) { res.status(409).json({ ok: false, code: 'no_active_world', error: 'The active world changed.' }); return; }
      res.json({ ok: true, savePath: store.worldRoot, ...page });
    } catch (err) {
      res.status(500).json({ ok: false, code: 'internal', error: err instanceof Error ? err.message : String(err) });
    }
  });
  return router;
}
