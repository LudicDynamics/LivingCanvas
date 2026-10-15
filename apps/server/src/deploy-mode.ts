/**
 * This server's build mode (packages/shared/src/deploy-mode): read once at start, before any service URL is
 * used. Refuses to start — a thrown error, so `node` exits non-zero and the in-tab browser runtime fails its boot
 * with the reason — when the mode is missing, a login-on mode lacks a service URL, or the identity client is not
 * in this build. Never decides the mode from what happens to be installed.
 *
 *   GET /api/health      { ok, deploy, login, version, sha, label, identityClient }
 *   /api/remote/login*   403 login_off when WORLDLINES_LOGIN=off
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { buildInfo, loadDeployMode, modeLabel, type BuildInfo, type LoadedMode } from '@airp/shared/deploy-mode/node';
import { identityClientBundled } from './sync/auth-provider.js';

export interface ServerMode { mode: LoadedMode; build: BuildInfo; label: string; identityClient: boolean }

let current: ServerMode | null = null;

/**
 * `codeRoot`: where this server's own `config/.env.<deploy>` lives (the checkout it runs from — not
 * AIRP_REPO_ROOT, which tests point elsewhere). Local development falls back to `local`; every production
 * entry point sets AIRP_DEPLOY explicitly.
 */
export function startDeployMode(codeRoot: string, env: NodeJS.ProcessEnv = process.env): ServerMode {
  const mode = loadDeployMode({ repoRoot: codeRoot, env: env as Record<string, string | undefined>, fallback: 'local' });
  const identityClient = identityClientBundled();
  if (mode.login === 'on' && !identityClient) {
    throw new Error('[AIRP Server] WORLDLINES_LOGIN=on but the Worldlines identity client is not in this build (vendor/worldlines-identity-client). Refusing to start: sign-in would work but tokens could never be refreshed.');
  }
  const build = buildInfo(codeRoot, env as Record<string, string | undefined>);
  current = { mode, build, label: modeLabel(mode, build), identityClient };
  return current;
}

export const serverMode = (): ServerMode | null => current;
export const loginEnabled = () => current?.mode.login === 'on';

export function healthBody(m: ServerMode) {
  return { ok: true, deploy: m.mode.deploy, login: m.mode.login, version: m.build.version, sha: m.build.sha, label: m.label, identityClient: m.identityClient };
}

export function createModeRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!current) return res.status(503).json({ ok: false, code: 'not_started' });
    res.json(healthBody(current));
  });
  router.use('/remote/login', (req: Request, res: Response, next: NextFunction) => {
    if (current?.mode.login === 'off') return res.status(403).json({ ok: false, code: 'login_off', error: 'Worldlines login is off in this build (WORLDLINES_LOGIN=off in config/.env.local).' });
    next();
  });
  return router;
}
