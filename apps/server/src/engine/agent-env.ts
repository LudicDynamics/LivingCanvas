/**
 * agent-env.ts — what an agent process may see of the server's environment.
 *
 * `presets.ts` has always MEANT the agents to get a whitelist (AIRP_ENV_PASSTHROUGH,
 * "Whitelist, NOT `...process.env`"). It never did: the vendored pi-rp spawns
 * every agent with `env: { ...process.env, ...options.env }`
 * (modes/rpc/rpc-client.js), so the whitelist was only ever ADDED on top of the
 * whole server environment. Every writer and character therefore held every
 * key the server held — DashScope, Flow, the local TTS key, the translate key —
 * whether or not it used that provider, and an agent with a shell could print
 * them (security audit, 2026-09-25).
 *
 * The fix does not touch pi-rp. Node's `child_process` drops any env entry
 * whose value is `undefined`, so handing pi-rp an explicit `undefined` for a
 * key REMOVES that key after pi-rp's own spread. `withholdSecrets` does exactly
 * that for every secret-looking name the agent was not deliberately given.
 *
 * What stays: whatever the caller put in the agent env on purpose — its own
 * model key among them, because the agent calls its model itself — and every
 * non-secret variable (PATH, HOME, locale, proxy), which tools legitimately need.
 */

/**
 * A variable name that carries a credential. Deliberately broad: a false
 * positive costs an agent a variable it did not need, a false negative costs a
 * leaked key. Matched on NAMES only; values are never inspected.
 * `AIRP_REMOTE_*` covers the local ↔ remote link:
 * its account session lives in a file outside every world, and the variable
 * naming that file is not an agent's business either. `AIRP_AUTH_*` (where
 * that sign-in happens) is caught by the `AUTH` segment.
 */
export const SECRET_NAME = /(?:^|_)(?:API_?KEY|KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|CREDENTIALS?|PRIVATE|SESSION|COOKIE|AUTH)(?:_|$)|^(?:DASHSCOPE|FLOW|SUPABASE|AWS|GH|GITHUB|NPM|ANTHROPIC|TYPESAFE|AIRP_REMOTE)_/i;

/**
 * The env to hand pi-rp: the agent's own entries, plus an explicit `undefined`
 * for every secret-looking variable of the parent that the agent was not given.
 * Pure — both environments are arguments.
 */
export function withholdSecrets(
  agentEnv: Record<string, string>,
  parentEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...agentEnv };
  for (const name of Object.keys(parentEnv)) {
    if (name in agentEnv) continue;
    if (SECRET_NAME.test(name)) out[name] = undefined;
  }
  return out;
}

/** The names `withholdSecrets` removes — for a startup log line, never the values. */
export function withheldNames(agentEnv: Record<string, string>, parentEnv: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(withholdSecrets(agentEnv, parentEnv))
    .filter(([, value]) => value === undefined)
    .map(([name]) => name)
    .sort();
}

/**
 * The env to pass as `RpcClient({ env })`. Typed as pi-rp expects, but it
 * DOES carry `undefined` values — that is the whole mechanism (see top) — so
 * it must go straight into `RpcClient` and never be spread or serialised.
 */
export function agentSpawnEnv(agentEnv: Record<string, string>): Record<string, string> {
  return withholdSecrets(agentEnv) as Record<string, string>;
}
