import { Router, type Response } from 'express';
import { localRequest } from './connection-settings.js';
import {
  setNickname,
  reportTurn,
  reportOpen,
  reportUsage,
  setLike,
  usage,
  worldNumbers,
  announcements,
  worldLogs,
  lobbyLogs,
  comments,
  report,
  sendFeedback,
  DataRefused,
  DataUnavailable,
  deleteReview,
  putSaveSummary,
  ratings,
  redeem,
  claimDaily,
  claimNewcomer,
  invite,
  reportMilestone,
  rewards,
  claimReward,
  saveSettings,
  setFavorite,
  setReview,
  snapshot,
  worldIdOf,
  type AccountDataDeps,
} from '../sync/account-data.js';
import { guestFeedbackToken } from '../sync/guest-session.js';

/**
 * The page's door to the account's settings, favorites, ratings and save
 * summaries (sync/account-data.ts). Like /api/remote next to it: localhost
 * only, writes need `X-AIRP-Settings: 1`, and no answer ever carries a token.
 *
 * "Not available" (signed out, data not deployed, an old sign-in, offline) is
 * a normal answer — `{ ok: false, available: false, reason }` with 200 — so the
 * page keeps things on this device without showing an error.
 */
export function createAccountDataRouter(deps: AccountDataDeps & { guestToken?: (opts?: { force?: boolean }) => Promise<string | null> } = {}): Router {
  const router = Router();
  router.use('/account-data', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!localRequest(req)) return res.status(403).json({ ok: false, code: 'local_only', error: 'Account data is available on localhost only.' });
    if (req.method !== 'GET' && req.headers['x-airp-settings'] !== '1') return res.status(403).json({ ok: false, code: 'bad_request', error: 'Invalid account data request.' });
    next();
  });
  const run = async (res: Response, work: () => Promise<Record<string, unknown>>) => {
    try {
      res.json({ ok: true, available: true, ...(await work()) });
    } catch (err) {
      if (err instanceof DataUnavailable) return res.json({ ok: false, available: false, reason: err.reason });
      if (err instanceof DataRefused) return res.status(err.status).json({ ok: false, available: true, code: err.code, error: err.message });
      console.warn('[account-data] failed:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ ok: false, available: true, code: 'internal', error: 'Account data failed.' });
    }
  };

  router.get('/account-data', (_req, res) => run(res, async () => ({ ...(await snapshot(deps)) })));
  router.put('/account-data/settings', (req, res) => run(res, async () => saveSettings(req.body?.prefs, deps)));
  router.put('/account-data/favorites/:world', (req, res) => run(res, async () => setFavorite(worldIdOf(req.params.world), req.body?.on === true, deps)));
  router.put('/account-data/reviews/:world', (req, res) => run(res, async () => setReview(worldIdOf(req.params.world), req.body ?? {}, deps)));
  router.delete('/account-data/reviews/:world', (req, res) => run(res, async () => { await deleteReview(worldIdOf(req.params.world), deps); return {}; }));
  router.put('/account-data/saves/:save', (req, res) => run(res, async () => ({ summary: await putSaveSummary(req.params.save, req.body ?? {}, deps) })));
  // Public: a world's comments (signed out too; `mine` marks the player's own), and the banners on now (日志 v5, else the old announcements).
  router.get('/account-data/comments', (req, res) => run(res, async () => comments(worldIdOf(req.query.world), deps, typeof req.query.cursor === 'string' && req.query.cursor.length <= 400 ? req.query.cursor : null) as unknown as Promise<Record<string, unknown>>));
  // The public nickname shown with this player's comments (empty = anonymous again).
  router.put('/account-data/profile', (req, res) => run(res, async () => setNickname(req.body?.nickname, deps)));
  router.put('/account-data/likes/:world', (req, res) => run(res, async () => setLike(worldIdOf(req.params.world), req.body?.on === true, deps)));
  // Public numbers for the launcher: ratings, likes (data) and plays (chronicle). refs = key:ed1|ed2,…
  router.get('/account-data/world-stats', (req, res) => run(res, async () => {
    const keys = String(req.query.worlds ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const refs: Record<string, string[]> = {};
    for (const part of String(req.query.refs ?? '').split(',')) {
      const [k, list] = part.split(':');
      if (k && list) refs[k] = list.split('|').filter(Boolean).slice(0, 4);
    }
    return { stats: await worldNumbers(keys, refs, deps) };
  }));
  // The account's tokens / spend today and this month, and its wallet (account panel).
  router.get('/account-data/usage', (_req, res) => run(res, async () => ({ usage: await usage(deps) })));
  // 「输入兑换码」: a redemption code → 体验会员 and / or credits (billing POST /v1/me/redeem with the account's token).
  router.post('/account-data/redeem', (req, res) => run(res, async () => redeem(req.body ?? {}, deps) as unknown as Promise<Record<string, unknown>>));
  // 「领取今日额度」: today's free allowance into the shared worldlines wallet (billing POST /v1/claims/worldlines/daily, the account's token).
  router.post('/account-data/claim-daily', (req, res) => run(res, async () => claimDaily(deps, req.body?.device) as unknown as Promise<Record<string, unknown>>));
  // 新手礼包: 500 credits once per account, asked for without a click on scene entry / an action (billing POST /v1/claims/worldlines/newcomer).
  router.post('/account-data/claim-newcomer', (req, res) => run(res, async () => claimNewcomer(deps, req.body?.device) as unknown as Promise<Record<string, unknown>>));
  // 「邀请好友」: the account's invite code, link and numbers; a first ending (the inviter's reward); claimable rewards.
  router.get('/account-data/invite', (_req, res) => run(res, async () => invite(deps) as unknown as Promise<Record<string, unknown>>));
  router.post('/account-data/milestones', (req, res) => run(res, async () => reportMilestone(req.body ?? {}, deps)));
  router.get('/account-data/rewards', (_req, res) => run(res, async () => rewards(deps) as unknown as Promise<Record<string, unknown>>));
  router.post('/account-data/rewards/:id/claim', (req, res) => run(res, async () => claimReward(req.params.id, deps, req.body?.device) as unknown as Promise<Record<string, unknown>>));
  // A writer turn finished: chronicle hears about it (play counts). Best effort.
  // A world was opened: chronicle counts it (「总打开次数」, 30-minute fold per player per world). Best effort.
  router.post('/account-data/opens', (req, res) => run(res, async () => reportOpen(req.body ?? {}, deps)));
  // 改进产品: a signed-in page's anonymous-usage batch → chronicle /v1/events with the account's token (lib/analytics.ts).
  router.post('/account-data/events', (req, res) => run(res, async () => reportUsage(req.body ?? {}, deps)));
  router.post('/account-data/turns', (req, res) => run(res, async () => reportTurn(req.body ?? {}, deps)));
  // Public 日志: ?world=<id> = that world's 「更新记录」 (latest three, surface world); otherwise the lobby's 「日志」 tab
  // (surface lobby, ten a page; ?before=<the previous page's nextBefore>).
  router.get('/account-data/logs', (req, res) => run(res, async () => (req.query.world !== undefined
    ? { logs: await worldLogs(worldIdOf(req.query.world), deps) }
    : { ...(await lobbyLogs(req.query.before, deps)) })));
  router.get('/account-data/announcements', (_req, res) => run(res, async () => ({ announcements: await announcements(deps) })));
  // Flag a comment for the admins (signed in).
  router.post('/account-data/reports/:review', (req, res) => run(res, async () => report(req.params.review, req.body ?? {}, deps)));
  // 「报告问题 / 卡住了」: to the admins (console 玩家反馈) as the account, else as this device's guest-trial session.
  router.post('/account-data/feedback', (req, res) => run(res, async () => sendFeedback(req.body ?? {}, { ...deps, guestToken: deps.guestToken ?? ((o) => guestFeedbackToken(o)) })));
  // Public counts + averages: works signed out too (no token is sent).
  router.get('/account-data/ratings', (req, res) => run(res, async () => {
    const worlds = String(req.query.worlds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return { ratings: await ratings(worlds, deps) };
  }));
  return router;
}
