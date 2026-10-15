#!/usr/bin/env node
/**
 * The build mode for shell scripts (packages/shared/src/deploy-mode; needs `pnpm --filter @airp/shared build`).
 *
 *   node tools/deploy-mode.mjs env <remote|local>      shell `export` lines: the mode file's values (the environment
 *                                                      wins), AIRP_RELEASE / AIRP_BUILD_SHA. Exit 1 on a bad mode.
 *   node tools/deploy-mode.mjs label [remote|local]    the one-line mode + version
 *   node tools/deploy-mode.mjs check-site <dir> <remote|local> [--info <file>]
 *                                                      gate on a built browser site: the web bundle says this mode
 *                                                      and carries every service URL; with login on, runtime/<rid>/
 *                                                      server.js carries the identity client. --info writes the
 *                                                      build's mode / release / sha / rid as JSON (outside the site:
 *                                                      it must not be uploaded with an immutable cache).
 *
 * The mode is always an argument here: production scripts never fall back to a default.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = path.join(REPO, 'packages/shared/dist/deploy-mode/node.js');

const die = (msg) => { process.stderr.write(`deploy-mode: ${msg}\n`); process.exit(1); };
const quote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

export async function load(deploy, env = { ...process.env }) {
  if (!fs.existsSync(lib)) die('build packages/shared first (pnpm --filter @airp/shared build)');
  const m = await import(lib);
  if (deploy !== 'remote' && deploy !== 'local') die(`say the mode: remote or local (got ${JSON.stringify(deploy ?? null)})`);
  try {
    const mode = m.loadDeployMode({ repoRoot: REPO, env, deploy });
    const build = m.buildInfo(REPO, env);
    return { m, mode, build, env };
  } catch (e) { die(e.message); }
}

/** Every JS / HTML text under `dir` (the web bundle), one string. */
const textOf = (dir) => {
  let out = '';
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'runtime') walk(p); } else if (/\.(js|html)$/.test(e.name)) out += fs.readFileSync(p, 'utf8');
  } };
  walk(dir);
  return out;
};

/** Problems of a built browser site for `mode` (empty = good). Exported for tests. */
export function siteProblems(dir, mode) {
  const problems = [];
  if (!fs.existsSync(path.join(dir, 'index.html'))) return [`${dir}/index.html missing`];
  const web = textOf(dir);
  const said = (k, v) => new RegExp(`${k}\\s*:\\s*["'\`]${v.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}["'\`]`).test(web);
  if (!said('VITE_AIRP_DEPLOY', mode.deploy)) problems.push(`the web bundle does not say VITE_AIRP_DEPLOY=${mode.deploy}`);
  if (!said('VITE_WORLDLINES_LOGIN', mode.login)) problems.push(`the web bundle does not say VITE_WORLDLINES_LOGIN=${mode.login}`);
  for (const [k, v] of Object.entries(mode.services)) if (v && !said(`VITE_${k}`, v)) problems.push(`the web bundle lacks VITE_${k}=${v}`);
  const runtime = path.join(dir, 'runtime');
  const rids = fs.existsSync(runtime) ? fs.readdirSync(runtime) : [];
  if (rids.length !== 1) problems.push(`expected exactly one runtime/<rid> in ${dir} (found ${rids.length})`);
  else if (mode.login === 'on') {
    const server = path.join(runtime, rids[0], 'server.js');
    const code = fs.existsSync(server) ? fs.readFileSync(server, 'utf8') : '';
    if (!/function refreshTokens\(/.test(code)) problems.push('runtime server.js does not contain the identity client (refreshTokens)');
    if (!/IdentityError\s*=\s*class/.test(code)) problems.push('runtime server.js does not contain the identity client (IdentityError)');
  }
  return problems;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'env') {
    const { mode, build, env } = await load(rest[0]);
    const lines = [];
    const fileKeys = Object.keys(env).filter((k) => env[k] !== process.env[k]);
    for (const k of fileKeys) lines.push(`export ${k}=${quote(env[k])}`);
    lines.push(`export AIRP_DEPLOY=${quote(mode.deploy)} WORLDLINES_LOGIN=${quote(mode.login)}`);
    lines.push(`export AIRP_RELEASE=${quote(build.version)} AIRP_BUILD_SHA=${quote(build.sha ?? '')}`);
    process.stdout.write(`${lines.join('\n')}\n`);
  } else if (cmd === 'label') {
    const { m, mode, build } = await load(rest[0] ?? process.env.AIRP_DEPLOY ?? 'local');
    process.stdout.write(`${m.modeLabel(mode, build)}\n`);
  } else if (cmd === 'check-site') {
    const [dir, deploy] = rest;
    const infoAt = rest.indexOf('--info');
    const infoFile = infoAt >= 0 ? rest[infoAt + 1] : null;
    if (!dir) die('check-site <dir> <remote|local> [--info <file>]');
    const { m, mode, build } = await load(deploy);
    const problems = siteProblems(dir, mode);
    if (problems.length) die(`the built site is not a good ${deploy} build:\n  - ${problems.join('\n  - ')}`);
    const rid = fs.readdirSync(path.join(dir, 'runtime'))[0];
    const info = { deploy: mode.deploy, login: mode.login, release: build.version, sha: build.sha, rid, label: m.modeLabel(mode, build), identityClient: mode.login === 'on' };
    if (infoFile) fs.writeFileSync(infoFile, `${JSON.stringify(info, null, 2)}\n`);
    process.stdout.write(`site ok: ${info.label} (runtime ${rid})\n`);
  } else {
    die('usage: env <remote|local> | label [remote|local] | check-site <dir> <remote|local> [--info <file>]');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
