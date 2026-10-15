/**
 * End-to-end acceptance for the B6 gateway.
 *
 * Runs against a REAL built server process, because the three things this batch
 * changes are all shell-level and invisible to unit tests:
 * 1. `/ws` without `?v=1` must be closed with 4400.
 * 2. `/ws?v=1` must connect and receive `replay_done`.
 *   3. `/ws/stt` must still complete its upgrade — no key here, so the proof is
 *      the deterministic `{type:'error',code:'stt_unavailable'}` frame
 *      (stt-stream.ts:38-42). This is the one that would silently die if the
 *      upgrade hook `return`ed without `handleUpgrade` (REVIEW B1).
 *
 * Usage: node apps/server/test/probe-gateway.mjs [--port 3199]
 * Requires `pnpm build` first (it boots `apps/server/dist/index.js`).
 *
 * Each check prints PASS/FAIL and the script exits non-zero on any failure.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const argv = process.argv.slice(2);
const portFlag = argv.indexOf('--port');
const PORT = portFlag === -1 ? 3199 : Number(argv[portFlag + 1]);
const REPO = join(import.meta.dirname, '..', '..', '..');
const SERVER = join(REPO, 'apps/server/dist/index.js');

if (!existsSync(SERVER)) {
  console.error(`✖ ${SERVER} not found — run \`pnpm build\` first.`);
  process.exit(2);
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Connect and resolve with the close code, or the frames seen before close. */
function probe(path, { settleMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const frames = [];
    let closed = null;
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${path}`);
    const done = () => resolve({ frames, closed });
    ws.on('message', (raw) => {
      try { frames.push(JSON.parse(raw.toString())); } catch { frames.push(raw.toString()); }
    });
    ws.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; setTimeout(done, 50); });
    ws.on('error', (err) => { closed = { code: 'ERR', reason: err.message }; setTimeout(done, 50); });
    setTimeout(() => { try { ws.close(); } catch { /* already closed */ } ; setTimeout(done, 100); }, settleMs);
  });
}

const world = mkdtempSync(join(tmpdir(), 'airp-gw-probe-'));
const server = spawn(process.execPath, [SERVER], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), AIRP_HOST: '127.0.0.1', AIRP_WORLD: world },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d.toString(); });
server.stderr.on('data', (d) => { serverLog += d.toString(); });

try {
  // Wait for listen (or fail fast if the process dies).
  const deadline = Date.now() + 15_000;
  let up = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) break;
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/worlds`);
      if (res.ok) { up = true; break; }
    } catch { /* not listening yet */ }
    await sleep(150);
  }
  if (!up) {
    console.error('✖ server did not come up. Log tail:\n' + serverLog.split('\n').slice(-25).join('\n'));
    process.exit(1);
  }

  // 1. SPA/static surface is untouched by the noServer change.
  const spa = await fetch(`http://127.0.0.1:${PORT}/`);
  check('SPA still served over HTTP', spa.ok, `status ${spa.status}`);

  // 2. /ws with NO ?v= must be closed with 4400 (or at least NOT accepted as a
  //    working socket: a rejected upgrade shows up as ERR/400/1006).
  const noV = await probe('/ws');
  const rejectedNoV = noV.closed?.code === 4400;
  check('`/ws` without ?v= is refused with 4400', rejectedNoV,
    `closed=${JSON.stringify(noV.closed)} frames=${noV.frames.length}`);

  // 3. /ws?v=1 must connect and get `replay_done` (the R1 boundary frame).
  const withV = await probe('/ws?v=1');
  const hasReplayDone = withV.frames.some((f) => f?.type === 'replay_done');
  const hasConnected = withV.frames.some((f) => f?.type === 'connected');
  check('`/ws?v=1` connects', hasConnected, `frames=${JSON.stringify(withV.frames.map((f) => f?.type))}`);
  check('`/ws?v=1` receives replay_done', hasReplayDone,
    hasReplayDone ? `turns=${withV.frames.find((f) => f?.type === 'replay_done')?.turns}` : 'frame absent');

  // 4. /ws/stt must still upgrade — this is REVIEW B1's failure mode: a hook
  //    branch that `return`s without handleUpgrade leaves the socket unopened
  //    and voice input silently dies. The proof is that the relay ANSWERS:
  //    `{type:'ready'}` when a key is configured, `{type:'error',code:
  //    'stt_unavailable'}` when not (stt-stream.ts:37-42). Either one proves
  //    the upgrade hook reached handleSttStream; no frame at all would not.
  const stt = await probe('/ws/stt');
  const sttAnswered = stt.frames.some((f) => f?.type === 'ready')
    || stt.frames.some((f) => f?.type === 'error' && f?.code === 'stt_unavailable');
  check('/ws/stt upgrade still lands (voice input not dead)', sttAnswered,
    `frames=${JSON.stringify(stt.frames)} closed=${JSON.stringify(stt.closed)}`);

  // 5. A version mismatch must actually carry the close CODE (REVIEW §5-5 spike).
  const badV = await probe('/ws?v=0');
  check('`/ws?v=0` is refused with 4400 (code survives the handshake)',
    badV.closed?.code === 4400, `closed=${JSON.stringify(badV.closed)}`);
} finally {
  server.kill('SIGTERM');
  await sleep(400);
  if (server.exitCode === null) server.kill('SIGKILL');
  rmSync(world, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\nprobe-gateway: ${failed.length ? `FAIL (${failed.length}/${results.length})` : `PASS (${results.length}/${results.length})`}`);
process.exit(failed.length ? 1 : 0);
