/**
 * The build mode of LivingCanvas. Exactly two modes, one codebase:
 *
 *   remote  hosted production (canvas.worldlines.gg + our deploys). `config/.env.remote`, private repo only.
 *           Worldlines login is always on.
 *   local   the open-source edition (`config/.env.local`, the only mode file in the public repo).
 *           `WORLDLINES_LOGIN=on` (default) connects to the Worldlines account services;
 *           `WORLDLINES_LOGIN=off` is pure bring-your-own-key: no sign-in, nothing reported.
 *
 * The mode is always SAID, never guessed: nothing here looks at whether a module or a file happens to exist
 * (on 2026-10-07 an optional identity loader silently turned production into a no-login build).
 * This file is browser-safe; reading the mode files is in ./node.ts.
 */

export type Deploy = 'remote' | 'local';
export type Login = 'on' | 'off';

/** The Worldlines services a login-on build talks to. All public URLs; never a secret. */
export const SERVICE_KEYS = [
  'AIRP_ID_BASE', // auth.worldlines.gg — sign-in, tokens, world ownership
  'AIRP_STORAGE_BASE', // storage.worldlines.gg — world files
  'AIRP_AI_ACCOUNT_BASE', // ai.worldlines.gg/v1 — models / voice billed to the account
  'AIRP_BILLING_BASE', // billing.worldlines.gg — wallet, rewards
  'AIRP_CHRONICLE_BASE', // chronicle.worldlines.gg — play counts, usage reports (privacy rules: web lib/analytics.ts)
  'AIRP_DATA_BASE', // data.worldlines.gg — settings sync, favorites, reviews
] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

export interface DeployMode {
  deploy: Deploy;
  login: Login;
  /** Service URLs (login on); with login off every one is null. */
  services: Record<ServiceKey, string | null>;
}

export class DeployModeError extends Error {
  constructor(public problems: string[]) {
    super(`LivingCanvas build mode is not usable:\n  - ${problems.join('\n  - ')}`);
    this.name = 'DeployModeError';
  }
}

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** `KEY=value` lines (comments, blank lines, `export `, single / double quotes). No interpolation. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

const isUrl = (v: string) => {
  try { const u = new URL(v); return u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)); } catch { return false; }
};

/**
 * The mode from an environment (process.env, or Vite's import.meta.env with the VITE_ prefix stripped).
 * Throws DeployModeError listing every problem: no silent default, no half-configured login.
 */
export function resolveDeployMode(env: Record<string, string | undefined>): DeployMode {
  const problems: string[] = [];
  const deploy = clean(env.AIRP_DEPLOY);
  const login = clean(env.WORLDLINES_LOGIN);
  if (deploy !== 'remote' && deploy !== 'local') problems.push(`AIRP_DEPLOY must be "remote" or "local" (got ${JSON.stringify(deploy || null)})`);
  if (login !== 'on' && login !== 'off') problems.push(`WORLDLINES_LOGIN must be "on" or "off" (got ${JSON.stringify(login || null)})`);
  if (deploy === 'remote' && login === 'off') problems.push('a remote (hosted) build always has WORLDLINES_LOGIN=on');
  const services = {} as Record<ServiceKey, string | null>;
  for (const k of SERVICE_KEYS) {
    const v = clean(env[k]).replace(/\/+$/, '');
    if (login !== 'on') { services[k] = null; continue; }
    if (!v) problems.push(`${k} is not set (login on needs every Worldlines service URL)`);
    else if (!isUrl(v)) problems.push(`${k} is not an https URL: ${JSON.stringify(v)}`);
    services[k] = v || null;
  }
  if (problems.length) throw new DeployModeError(problems);
  return { deploy: deploy as Deploy, login: login as Login, services };
}

export interface BuildInfo {
  /** package version (local) or the release id `canvas-YYYYMMDD-HHMM` (remote). */
  version: string;
  /** short git sha; null when not known. */
  sha: string | null;
}

/** The one line shown at the bottom of the account dialog and in /api/health. */
export function modeLabel(mode: Pick<DeployMode, 'deploy' | 'login'>, build: BuildInfo): string {
  if (mode.deploy === 'remote') return ['remote', build.version, build.sha].filter(Boolean).join(' · ');
  return `local · login ${mode.login} · ${build.version}${build.sha ? ` (${build.sha})` : ''}`;
}
