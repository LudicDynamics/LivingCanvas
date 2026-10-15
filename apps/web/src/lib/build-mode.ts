/// <reference types="vite/client" />
/**
 * This web build's mode (packages/shared/src/deploy-mode): `remote` (canvas.worldlines.gg) or `local` (the
 * open-source edition, login on | off). vite.config.ts reads config/.env.<deploy> and hands it over as
 * VITE_AIRP_DEPLOY / VITE_WORLDLINES_LOGIN / VITE_AIRP_VERSION / VITE_AIRP_BUILD_SHA + the service URLs.
 * A build without a valid mode does not guess: `buildModeProblem()` says why, and browser mode refuses to boot.
 */
import { DeployModeError, modeLabel, resolveDeployMode, SERVICE_KEYS, type DeployMode } from '@airp/shared/deploy-mode';

const ENV = ((import.meta as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;

/** VITE_* → the names the shared resolver knows. */
export function modeEnvOf(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { AIRP_DEPLOY: env.VITE_AIRP_DEPLOY, WORLDLINES_LOGIN: env.VITE_WORLDLINES_LOGIN };
  for (const k of SERVICE_KEYS) out[k] = env[`VITE_${k}`];
  return out;
}

function resolve(): { mode: DeployMode | null; problem: string | null } {
  try { return { mode: resolveDeployMode(modeEnvOf(ENV)), problem: null }; } catch (e) {
    return { mode: null, problem: e instanceof DeployModeError ? e.message : String(e) };
  }
}
const resolved = resolve();

export const buildMode = (): DeployMode | null => resolved.mode;
/** Why this build has no usable mode (null: it has one). */
export const buildModeProblem = (): string | null => resolved.problem;
/** Is Worldlines sign-in part of this build? Only an explicit `on` says yes. */
export const loginEnabled = (): boolean => resolved.mode?.login === 'on';
export const buildVersion = () => ({ version: (ENV.VITE_AIRP_VERSION ?? '').trim() || '0.0.0', sha: (ENV.VITE_AIRP_BUILD_SHA ?? '').trim() || null });
/** "remote · canvas-YYYYMMDD-HHMM · <sha>" / "local · login on · <version>" (account dialog footer, /api/health). */
export function buildModeLabel(): string {
  return resolved.mode ? modeLabel(resolved.mode, buildVersion()) : 'mode not set';
}
