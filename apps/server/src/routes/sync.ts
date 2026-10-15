import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { isTenantId } from '../engine/user-root.js';
import { BUNDLE_TYPE, BundleError, bundleLimits } from '../sync/bundle.js';
import { bundleForDownload, coverForDownload, forceUnpublishToOwner, listSyncWorlds, publishFromTenant, unpublishToTenant, uploadToTenant } from '../sync/tenant.js';

/**
 * The hosted side of local ↔ remote: a LOCAL AIRP
 * server acting for its owner.
 *
 * Who the caller is comes from the account system, not from this app: the
 * local server presents the owner's account access token (`Authorization:
 * Bearer <JWT>`, the same account as the hosted login), the seat gateway
 * verifies it (deploy/vps/seat-gateway.mjs `verifyBearer`) and forwards the
 * call here with the verified uid in `X-AIRP-Auth-Uid`, plus the gateway's
 * shared secret in `X-AIRP-Gateway-Secret`. This app never parses a token.
 *
 * The uid header is trusted ONLY together with that secret, and only when this
 * process was given one (`AIRP_SYNC_GATEWAY_SECRET`, set on the sync container
 * and the gateway, never on a seat): the gateway strips any client-sent copy of
 * both headers, and a seat — or anything else on the internal network that can
 * reach this container directly — cannot forge the secret. Everywhere else
 * (seats, `pnpm dev`) `/api/sync/*` answers 401.
 */

export const AUTH_UID_HEADER = 'x-airp-auth-uid';
export const GATEWAY_SECRET_HEADER = 'x-airp-gateway-secret';
/** The account's verified email, set by the gateway next to the uid (trusted only with the secret, like the uid). */
export const AUTH_EMAIL_HEADER = 'x-airp-auth-email';

/**
 * Admins who may 强制撤回 any public world: `AIRP_SYNC_ADMINS`, a comma list of
 * account emails and/or uids, set on the sync container only. Never in source.
 */
export function syncAdmins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env.AIRP_SYNC_ADMINS ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
}

/** Is the gateway-verified caller an admin? Call only after `gatewayUid` accepted the request. */
export function isSyncAdmin(req: Request, uid: string, admins: Set<string> = syncAdmins()): boolean {
  if (!admins.size) return false;
  if (admins.has(uid.toLowerCase())) return true;
  const email = req.headers[AUTH_EMAIL_HEADER];
  return typeof email === 'string' && admins.has(email.trim().toLowerCase());
}

/** The uid the gateway vouched for, or null. */
export function gatewayUid(req: Request): string | null {
  const secret = (process.env.AIRP_SYNC_GATEWAY_SECRET ?? '').trim();
  if (secret.length < 16) return null;
  const sent = req.headers[GATEWAY_SECRET_HEADER];
  if (typeof sent !== 'string') return null;
  const a = Buffer.from(sent);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const uid = req.headers[AUTH_UID_HEADER];
  // An account uid, never the developer (`local`) or an anonymous guest.
  if (!isTenantId(uid) || uid === 'local' || uid.startsWith('anon-')) return null;
  return uid;
}

type Failure = { status: number; code: string; message: string };
const failure = (res: Response, err: unknown) => {
  if (res.headersSent) return;
  // An oversized body is answered as a sync error, not an HTML stack.
  if ((err as { type?: string } | null)?.type === 'entity.too.large') return res.status(413).json({ ok: false, code: 'too_large', error: 'The bundle is larger than the upload limit.' });
  if (err instanceof BundleError) {
    const known = err as unknown as Failure;
    return res.status(known.status).json({ ok: false, code: known.code, error: known.message });
  }
  console.warn('[Sync] failed:', err instanceof Error ? err.message : String(err));
  return res.status(500).json({ ok: false, code: 'internal', error: 'The sync request failed on the server.' });
};

/** Fixed-window counters per user and bucket: enough to stop a runaway loop, not an abuse system. */
export function createRateLimiter(limits: Record<string, { max: number; windowMs: number }>, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return (uid: string, bucket: string): number | null => {
    const limit = limits[bucket];
    if (!limit) return null;
    const key = `${bucket}:${uid}`;
    const t = now();
    const current = windows.get(key);
    if (!current || t - current.start >= limit.windowMs) {
      windows.set(key, { start: t, count: 1 });
      return null;
    }
    if (current.count >= limit.max) return Math.ceil((current.start + limit.windowMs - t) / 1000);
    current.count += 1;
    return null;
  };
}

export const SYNC_RATE_LIMITS = {
  any: { max: 300, windowMs: 10 * 60_000 },
  upload: { max: 30, windowMs: 60 * 60_000 },
  download: { max: 120, windowMs: 60 * 60_000 },
  publish: { max: 60, windowMs: 60 * 60_000 },
};

export function createSyncRouter(repoRoot: string, options: { rateLimits?: typeof SYNC_RATE_LIMITS } = {}): Router {
  const router = Router();
  const limited = createRateLimiter(options.rateLimits ?? SYNC_RATE_LIMITS);

  // ── sync: a local AIRP server acting for a signed-in account ─────────────
  const authed = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    const uid = gatewayUid(req);
    if (!uid) return res.status(401).json({ ok: false, code: 'signed_out', error: 'Sign in with your account to use the remote.' });
    const wait = limited(uid, 'any');
    if (wait !== null) { res.setHeader('Retry-After', String(wait)); return res.status(429).json({ ok: false, code: 'rate_limited', error: `Too many sync requests. Try again in ${wait} s.` }); }
    res.locals.uid = uid;
    res.locals.admin = isSyncAdmin(req, uid);
    next();
  };
  const bucket = (name: keyof typeof SYNC_RATE_LIMITS) => (_req: Request, res: Response, next: NextFunction) => {
    const wait = limited(String(res.locals.uid), name);
    if (wait !== null) { res.setHeader('Retry-After', String(wait)); return res.status(429).json({ ok: false, code: 'rate_limited', error: `Too many ${name}s. Try again in ${wait} s.` }); }
    next();
  };
  router.use('/sync', authed);

  router.get('/sync/whoami', (_req, res) => {
    res.json({ ok: true, uid: res.locals.uid, admin: res.locals.admin === true, limits: bundleLimits() });
  });
  router.get('/sync/worlds', async (_req, res) => {
    try { res.json({ ok: true, admin: res.locals.admin === true, ...(await listSyncWorlds(repoRoot, String(res.locals.uid))) }); } catch (err) { failure(res, err); }
  });
  router.get('/sync/worlds/:id/bundle', bucket('download'), async (req, res) => {
    try {
      const built = await bundleForDownload(repoRoot, String(res.locals.uid), req.params.id, req.query.from);
      res.set({
        'Content-Type': BUNDLE_TYPE,
        'Content-Disposition': `attachment; filename="${req.params.id}.tar.gz"`,
        'X-AIRP-Revision': String(built.revision),
        'X-AIRP-Hash': built.hash,
        'X-AIRP-From': built.from,
      });
      res.send(built.bundle);
    } catch (err) { failure(res, err); }
  });
  // A world's cover for the remote list: the same
  // tenancy as the bundle. With `h` equal to the file's hash the answer is
  // immutable for this account (`private`: a draft cover is its owner's only).
  router.get('/sync/worlds/:id/cover', async (req, res) => {
    try {
      const cover = await coverForDownload(repoRoot, String(res.locals.uid), req.params.id, req.query.from);
      const pinned = typeof req.query.h === 'string' && cover.hash === req.query.h;
      res.set({ 'Content-Type': cover.type, 'Cache-Control': pinned ? 'private, max-age=31536000, immutable' : 'private, no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.sendFile(cover.file, (err) => { if (err) failure(res, err); });
    } catch (err) { failure(res, err); }
  });
  // Parsed here, not globally: only this route takes a 200 MB body — and only
  // once the world is held (tenant.ts `uploadToTenant`): the requested id is
  // leased (or, without the identity service, claimed in-process) BEFORE the
  // body is read, so a second upload of it is refused at once instead of
  // racing the first through a 200 MB transfer.
  const rawBody = express.raw({ type: () => true, limit: bundleLimits().maxTotalBytes + 1024 * 1024 });
  router.post('/sync/worlds', bucket('upload'), async (req, res) => {
    const readBody = () => new Promise<Buffer>((resolve, reject) => {
      rawBody(req, res, (err?: unknown) => (err ? reject(err) : resolve(req.body as Buffer)));
    });
    try { res.json(await uploadToTenant(repoRoot, String(res.locals.uid), readBody, req.query.id)); } catch (err) { failure(res, err); }
  });
  router.post('/sync/worlds/:id/publish', bucket('publish'), async (req, res) => {
    try { res.json(await publishFromTenant(repoRoot, String(res.locals.uid), req.params.id)); } catch (err) { failure(res, err); }
  });
  router.post('/sync/worlds/:id/unpublish', bucket('publish'), async (req, res) => {
    try { res.json(await unpublishToTenant(repoRoot, String(res.locals.uid), req.params.id)); } catch (err) { failure(res, err); }
  });
  // 强制撤回: admins only; the world goes back to its AUTHOR's drafts (tenant.ts `forceUnpublishToOwner`).
  router.post('/sync/worlds/:id/force-unpublish', bucket('publish'), express.json({ limit: '8kb' }), async (req, res) => {
    if (res.locals.admin !== true) return res.status(403).json({ ok: false, code: 'not_admin', error: 'Only an admin can take down another author’s world.' });
    try { res.json(await forceUnpublishToOwner(repoRoot, String(res.locals.uid), req.params.id, req.body?.reason)); } catch (err) { failure(res, err); }
  });
  // An oversized body is answered as a sync error, not an HTML stack.
  router.use('/sync', (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const type = (err as { type?: string } | null)?.type;
    if (type === 'entity.too.large') return res.status(413).json({ ok: false, code: 'too_large', error: 'The bundle is larger than the upload limit.' });
    next(err);
  });
  return router;
}
