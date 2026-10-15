import { Router } from 'express';

/**
 * 托管方案 flag: whether the account panel shows the
 * Worldlines membership tiers and the links to the billing site (nothing is sold
 * in this app). On by default; `AIRP_PLANS_PREVIEW=0` hides the section, e.g. a
 * deployment whose billing site is not live.
 */
export function plansPreviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AIRP_PLANS_PREVIEW !== '0';
}

export function createPlansRouter(env: NodeJS.ProcessEnv = process.env): Router {
  const router = Router();
  router.get('/plans', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, plansPreview: plansPreviewEnabled(env) });
  });
  return router;
}
