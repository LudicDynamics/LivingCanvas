import { Router, type Response } from 'express';
import { localRequest } from './connection-settings.js';
import { DataRefused, DataUnavailable, type AccountDataDeps } from '../sync/account-data.js';
import { boardComments, boardCounts, boardFeed, boardPosts, deleteBoardRecord, postBoardComment, postBoardPost, reportBoard, targetOf } from '../sync/board.js';

/**
 * 公告 / 社区 (sync/board.ts) behind the same door as /api/account-data: localhost only, writes need
 * `X-AIRP-Settings: 1`, no token in any answer. Reads are public (signed out too); "not available" is
 * `{ ok: false, available: false, reason }` with 200 so the board just shows what it has.
 */
export function createBoardRouter(deps: AccountDataDeps = {}): Router {
  const router = Router();
  router.use('/board', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!localRequest(req)) return res.status(403).json({ ok: false, code: 'local_only', error: 'The board is available on localhost only.' });
    if (req.method !== 'GET' && req.headers['x-airp-settings'] !== '1') return res.status(403).json({ ok: false, code: 'bad_request', error: 'Invalid board request.' });
    next();
  });
  const run = async (res: Response, work: () => Promise<Record<string, unknown>>) => {
    try {
      res.json({ ok: true, available: true, ...(await work()) });
    } catch (err) {
      if (err instanceof DataUnavailable) return res.json({ ok: false, available: false, reason: err.reason });
      if (err instanceof DataRefused) {
        const extra = err as DataRefused & { retryAt?: string; minAgeDays?: number };
        return res.status(err.status).json({ ok: false, available: true, code: err.code, error: err.message, ...(extra.retryAt ? { retryAt: extra.retryAt } : {}), ...(extra.minAgeDays ? { minAgeDays: extra.minAgeDays } : {}) });
      }
      console.warn('[board] failed:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ ok: false, available: true, code: 'internal', error: 'The board failed.' });
    }
  };
  const cursorOf = (raw: unknown) => (typeof raw === 'string' && raw.length <= 400 ? raw : null);
  const kindOf = (raw: string) => (raw === 'posts' ? 'board-post' as const : 'board-comment' as const);

  router.get('/board/feed', (_req, res) => run(res, async () => ({ ...(await boardFeed(deps)) })));
  router.get('/board/counts', (req, res) => run(res, async () => ({ counts: await boardCounts(String(req.query.targets ?? '').split(',').map((s) => s.trim()).filter(Boolean), deps) })));
  router.get('/board/comments', (req, res) => run(res, async () => ({ ...(await boardComments(targetOf(req.query.target), deps, cursorOf(req.query.cursor))) })));
  router.post('/board/comments', (req, res) => run(res, async () => ({ ...(await postBoardComment(req.body ?? {}, deps)) })));
  router.get('/board/posts', (req, res) => run(res, async () => ({ ...(await boardPosts(deps, cursorOf(req.query.cursor))) })));
  router.post('/board/posts', (req, res) => run(res, async () => ({ ...(await postBoardPost(req.body ?? {}, deps)) })));
  for (const what of ['comments', 'posts']) {
    router.delete(`/board/${what}/:id`, (req, res) => run(res, async () => { await deleteBoardRecord(kindOf(what), req.params.id, deps); return {}; }));
    router.post(`/board/${what}/:id/report`, (req, res) => run(res, async () => ({ ...(await reportBoard(kindOf(what), req.params.id, req.body ?? {}, deps)) })));
  }
  return router;
}
