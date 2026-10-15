import { Router, type Request, type Response } from 'express';
import { assertAssetReference } from '@airp/shared';
import { localRequest } from './connection-settings.js';
import { DataRefused, DataUnavailable, type AccountDataDeps } from '../sync/account-data.js';
import { accountProfile, reportEnding } from '../sync/profile-data.js';
import { readProfileSaves, shownCgRoot } from '../profile-saves.js';

/**
 * The 个人页面.
 *
 *   GET  /api/profile/saves          this computer's saves: endings, 复盘, CGs shown, workshop (files only)
 *   GET  /api/profile/cg?save=&path= one CG a save has shown (nothing else)
 *   GET  /api/profile/account        chronicle playthroughs / endings / totals + the wallet's entries
 *   POST /api/profile/ending         an ending the page saw → chronicle (cross-device)
 *
 * The two account routes follow /api/account-data's rules: localhost only, writes
 * need `X-AIRP-Settings: 1`, no answer carries a token, and "not available"
 * (signed out, offline) is a normal `{ ok: false, available: false, reason }`.
 */
export function createProfileRouter(repoRoot: string, deps: AccountDataDeps = {}): Router {
  const router = Router();

  router.get('/profile/saves', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json({ ok: true, saves: await readProfileSaves(repoRoot) });
    } catch (err) {
      res.status(500).json({ ok: false, code: 'internal', error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/profile/cg', async (req, res) => {
    const root = await shownCgRoot(repoRoot, req.query.save, req.query.path).catch(() => null);
    if (!root) return res.status(404).json({ ok: false, code: 'not_found', error: 'No such CG in this save.' });
    try {
      const { absolutePath, mimeType } = await assertAssetReference(root, String(req.query.path), 'image');
      res.type(mimeType);
      res.set('Cache-Control', 'private, max-age=3600');
      res.sendFile(absolutePath, (err) => {
        if (err && !res.headersSent) res.status(404).json({ ok: false, code: 'not_found', error: err.message });
      });
    } catch {
      res.status(404).json({ ok: false, code: 'not_found', error: 'No such CG in this save.' });
    }
  });

  const guard = (req: Request, res: Response): boolean => {
    res.setHeader('Cache-Control', 'no-store');
    if (!localRequest(req)) { res.status(403).json({ ok: false, code: 'local_only', error: 'Account data is available on localhost only.' }); return false; }
    if (req.method !== 'GET' && req.headers['x-airp-settings'] !== '1') { res.status(403).json({ ok: false, code: 'bad_request', error: 'Invalid profile request.' }); return false; }
    return true;
  };
  const run = async (res: Response, work: () => Promise<Record<string, unknown>>) => {
    try {
      res.json({ ok: true, available: true, ...(await work()) });
    } catch (err) {
      if (err instanceof DataUnavailable) return res.json({ ok: false, available: false, reason: err.reason });
      if (err instanceof DataRefused) return res.status(err.status).json({ ok: false, available: true, code: err.code, error: err.message });
      console.warn('[profile] failed:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ ok: false, available: true, code: 'internal', error: 'Profile data failed.' });
    }
  };

  router.get('/profile/account', (req, res) => { if (guard(req, res)) void run(res, async () => ({ account: await accountProfile(deps) })); });
  router.post('/profile/ending', (req, res) => { if (guard(req, res)) void run(res, async () => reportEnding(req.body ?? {}, deps)); });
  return router;
}
