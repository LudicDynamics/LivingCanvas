/**
 * Reading the build mode files (Node only: the server, vite.config, build scripts, launchers).
 *
 *   config/.env.remote   hosted production; private repo only (tools/publish-export.mjs refuses to ship it)
 *   config/.env.local    the open-source edition; login on by default, WORLDLINES_LOGIN=off for bring-your-own-key
 *
 * These files hold public values only (mode + service URLs). Keys stay in the gitignored root `.env.local` /
 * `.env`, which the server loads first; neither of those can be confused with a mode file (different folder).
 * Precedence: the process environment > root .env.local > root .env > config/.env.<deploy>.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DeployModeError, parseEnvText, resolveDeployMode, type BuildInfo, type Deploy, type DeployMode } from './index.js';

export * from './index.js';

export const MODE_DIR = 'config';
export const modeFile = (repoRoot: string, deploy: Deploy) => path.join(repoRoot, MODE_DIR, `.env.${deploy}`);

export interface LoadedMode extends DeployMode {
  /** The mode file that was read (null: the environment carried everything, e.g. the in-tab browser runtime). */
  file: string | null;
}

/**
 * Pick the mode (`deploy` argument > env AIRP_DEPLOY > `fallback`), merge its file into `env` without overriding
 * anything already set, and validate. Login off also switches the reporting services off in `env`.
 * `fallback` exists for local development only; production scripts never pass one.
 */
export function loadDeployMode(opts: { repoRoot: string; env?: Record<string, string | undefined>; deploy?: string; fallback?: Deploy }): LoadedMode {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const deploy = (opts.deploy ?? env.AIRP_DEPLOY ?? opts.fallback ?? '').trim();
  if (deploy !== 'remote' && deploy !== 'local') {
    throw new DeployModeError([`no build mode given: set AIRP_DEPLOY=remote|local (got ${JSON.stringify(deploy || null)})`]);
  }
  if (env.AIRP_DEPLOY && env.AIRP_DEPLOY.trim() !== deploy) {
    throw new DeployModeError([`AIRP_DEPLOY=${env.AIRP_DEPLOY} in the environment contradicts the requested mode "${deploy}"`]);
  }
  const file = modeFile(opts.repoRoot, deploy);
  let read: string | null = null;
  if (fs.existsSync(file)) {
    const values = parseEnvText(fs.readFileSync(file, 'utf8'));
    if (values.AIRP_DEPLOY && values.AIRP_DEPLOY !== deploy) throw new DeployModeError([`${file} says AIRP_DEPLOY=${values.AIRP_DEPLOY}, expected ${deploy}`]);
    for (const [k, v] of Object.entries(values)) if (env[k] === undefined || env[k] === '') env[k] = v;
    read = file;
  } else if (!env.WORLDLINES_LOGIN) {
    throw new DeployModeError([
      deploy === 'remote'
        ? `${path.join(MODE_DIR, '.env.remote')} is missing — the hosted mode file lives in the private repository only`
        : `${path.join(MODE_DIR, '.env.local')} is missing — restore it (git checkout -- ${MODE_DIR}/.env.local)`,
    ]);
  }
  env.AIRP_DEPLOY = deploy;
  const mode = resolveDeployMode(env);
  if (mode.login === 'off') {
    // Bring-your-own-key: no account, so nothing goes to the account services.
    env.AIRP_DATA_BASE = 'off';
    env.AIRP_CHRONICLE_BASE = 'off';
    env.AIRP_AI_ACCOUNT = '0';
    // …and no guest trial either (it is a Worldlines service).
    env.AIRP_GUEST_TRIAL = '0';
  }
  return { ...mode, file: read };
}

/** The Vite (VITE_*) values of a mode, for the web build. Public values only. */
export function viteEnvOf(mode: DeployMode, build: BuildInfo): Record<string, string> {
  const s = mode.services;
  const out: Record<string, string> = {
    VITE_AIRP_DEPLOY: mode.deploy,
    VITE_WORLDLINES_LOGIN: mode.login,
    VITE_AIRP_VERSION: build.version,
    VITE_AIRP_BUILD_SHA: build.sha ?? '',
  };
  if (mode.login === 'on') {
    out.VITE_AIRP_ID_BASE = s.AIRP_ID_BASE!;
    out.VITE_AIRP_STORAGE_BASE = s.AIRP_STORAGE_BASE!;
    out.VITE_AIRP_BILLING_BASE = s.AIRP_BILLING_BASE!;
    out.VITE_AIRP_CHRONICLE_BASE = s.AIRP_CHRONICLE_BASE!;
    out.VITE_AIRP_DATA_BASE = s.AIRP_DATA_BASE!;
    out.VITE_AIRP_AI_ACCOUNT_BASE = s.AIRP_AI_ACCOUNT_BASE!;
  } else {
    out.VITE_AIRP_CHRONICLE_BASE = 'off';
    out.VITE_AIRP_DATA_BASE = 'off';
  }
  return out;
}

/** Version + short sha. `AIRP_RELEASE` / `AIRP_BUILD_SHA` win (the release script sets both); else package.json + git. */
export function buildInfo(repoRoot: string, env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): BuildInfo {
  let version = (env.AIRP_RELEASE ?? '').trim();
  if (!version) {
    try { version = String(JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version ?? ''); } catch { /* none */ }
  }
  let sha: string | null = (env.AIRP_BUILD_SHA ?? '').trim() || null;
  if (!sha) {
    try { sha = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { sha = null; }
  }
  return { version: version || '0.0.0', sha };
}
