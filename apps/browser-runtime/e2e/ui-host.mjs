// Dev host for trying browser mode in the real LivingCanvas UI:
//   node apps/browser-runtime/e2e/ui-host.mjs [--port 3197]
// then open http://127.0.0.1:3197/?mode=browser
// Runs the ordinary apps/server build (it serves apps/web/dist, the runtime
// bundles, the VFS image and the model proxy). Model keys come from the
// environment or, failing that, from a .env.local (AIRP_KEYS_FILE, default the
// main checkout's); only OPENAI_API_KEY / DEEPSEEK_API_KEY are passed on.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const KEYS_FILE = process.env.AIRP_KEYS_FILE ?? path.join(REPO, '.env.local');

function keysFromFile() {
  if (!fs.existsSync(KEYS_FILE)) return {};
  const out = {};
  for (const line of fs.readFileSync(KEYS_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*(OPENAI_API_KEY|DEEPSEEK_API_KEY)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Start apps/server on 127.0.0.1:<port>; resolves once it listens. */
export async function startUiHost({ port = 3197, quiet = false } = {}) {
  const keys = keysFromFile();
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), AIRP_HOST: '127.0.0.1', AIRP_REPO_ROOT: REPO,
    AIRP_WORLD: 'templates/whitechapel', AIRP_WRITER_THINKING: 'low',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? keys.OPENAI_API_KEY ?? '',
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? keys.DEEPSEEK_API_KEY ?? '',
  };
  for (const need of ['apps/server/dist/index.js', 'apps/web/dist/index.html', 'apps/browser-runtime/dist/worker.js']) {
    if (!fs.existsSync(path.join(REPO, need))) throw new Error(`missing ${need} — build first (see apps/browser-runtime/README)`);
  }
  const child = spawn(process.execPath, [path.join(REPO, 'apps/server/dist/index.js')], { env, cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  const onData = (d) => { const s = d.toString(); log.push(s); if (!quiet) process.stdout.write(s); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${url}/api/browser-runtime/status`)).ok) return { child, url, log }; } catch { /* not up yet */ }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`server did not come up:\n${log.join('').slice(-2000)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--port');
  const { url } = await startUiHost({ port: i > 0 ? Number(process.argv[i + 1]) : 3197 });
  console.log(`\nbrowser mode: ${url}/?mode=browser   (network mode, unchanged: ${url}/)`);
}
