#!/usr/bin/env node
/**
 * bench-writer-turn.mjs — replay a recorded writer session against the REAL
 * writer (pi-rp + the configured model) and measure each beat
 *.
 *
 *   node tools/bench-writer-turn.mjs --save <world dir> --session <writer .jsonl>
 *        [--from 13] [--beats 12] [--mode after|before] [--env-file .env.local] [--out result.json]
 *
 * What it does, on a COPY of the save (the source is never written):
 *  1. The writer session is cut just before user message `--from` (1-based) and
 *     installed as the writer's own thread, so the writer resumes with exactly
 *     the history it had at that beat.
 *  2. The next `--beats` user messages of the original session are replayed in
 *     order through `AgentLifecycleManager.submitWriter` — the server's own
 *     path (thinking policy, landing, compaction) — after pointing the
 *     viewpoint at the request's `[Current Layer]`, as the page does.
 *  3. Per beat it records: time to the first page change (`landed`), time to
 *     settle, steps (provider requests), first-step reasoning characters,
 *     context / cache tokens, and any compaction.
 *
 * A save that reached an ending is reopened on the copy (its recorded ending
 * removed), or every write would be refused.
 *
 * Approximation (stated in the report): world FILES are the save's final
 * state, not the state at beat `--from`, so a replayed request may meet a page
 * that already shows its own outcome. Both modes replay the same requests on
 * the same copy, so the comparison is fair; absolute numbers are not a replay
 * of history.
 *
 * `--mode before` turns the four changes off by their switches
 * (AIRP_WRITER_PAGES=0, AIRP_WRITER_THINKING_MODE=fixed,
 * AIRP_WRITER_EARLY_RELEASE=0, AIRP_WRITER_COMPACT=0). The two prompt
 * sentences of §1/§3 have no switch and stay in both modes.
 *
 * Costs real tokens. Never prints keys.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_CLI = path.join(REPO_ROOT, 'vendor/pi-rp/packages/coding-agent/dist/cli.js');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const SAVE = arg('save');
const SESSION = arg('session');
const FROM = Number(arg('from', '13'));
const BEATS = Number(arg('beats', '12'));
const MODE = arg('mode', 'after');
const ENV_FILE = arg('env-file', path.join(REPO_ROOT, '.env.local'));
const OUT = arg('out');
if (!SAVE || !SESSION || !['before', 'after'].includes(MODE)) {
  console.error('usage: node tools/bench-writer-turn.mjs --save <world dir> --session <writer .jsonl> [--from 13] [--beats 12] [--mode after|before] [--env-file f] [--out f]');
  process.exit(2);
}

if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
process.env.AIRP_AI_ACCOUNT = '0'; // talk to the provider directly, not through a running server's proxy
if (MODE === 'before') {
  Object.assign(process.env, {
    AIRP_WRITER_PAGES: '0',
    AIRP_WRITER_THINKING_MODE: 'fixed',
    AIRP_WRITER_EARLY_RELEASE: '0',
    AIRP_WRITER_COMPACT: '0',
  });
}

const { AgentLifecycleManager } = await import(path.join(REPO_ROOT, 'apps/server/dist/engine/lifecycle.js'));
const { isLandingTool } = await import(path.join(REPO_ROOT, 'apps/server/dist/engine/writer-beat-policy.js'));
const { LocalWorldStore } = await import(path.join(REPO_ROOT, 'packages/shared/dist/index.js'));

// ——— 1. the copy, with the session cut at --from ———
const work = fs.mkdtempSync(path.join(os.tmpdir(), `airp-bench-${MODE}-`));
const world = path.join(work, 'world');
fs.cpSync(SAVE, world, { recursive: true });
// A finished save refuses every write ("This story has ended"): reopen the copy
// by dropping the recorded ending (world/README.md status.data.ending — the one
// place it lives, the design notes).
const endingFile = path.join(world, 'world', 'README.md');
if (fs.existsSync(endingFile)) {
  fs.writeFileSync(endingFile, fs.readFileSync(endingFile, 'utf8').replace(/^\s+ending(?:Turn)?:.*\n/gm, ''));
}
const sessions = path.join(world, '.airpworld', 'sessions');
for (const name of fs.readdirSync(sessions)) {
  if (name.endsWith('.jsonl') || name.endsWith('.done')) fs.rmSync(path.join(sessions, name));
}
const lines = fs.readFileSync(SESSION, 'utf8').split('\n').filter(Boolean);
const rows = lines.map((l) => JSON.parse(l));
const userAt = rows.map((r, i) => (r.type === 'message' && r.message?.role === 'user' ? i : -1)).filter((i) => i >= 0);
if (FROM < 1 || FROM > userAt.length) throw new Error(`--from ${FROM} is outside 1..${userAt.length}`);
const cut = userAt[FROM - 1];
const header = { ...rows[0], cwd: fs.realpathSync(world) };
fs.writeFileSync(path.join(sessions, path.basename(SESSION).replace(/\.(jsonl|done)$/, '').replace(/\.loop-\d+$/, '') + '.jsonl'),
  [JSON.stringify(header), ...lines.slice(1, cut)].join('\n') + '\n');
const requests = userAt.slice(FROM - 1, FROM - 1 + BEATS).map((i) =>
  rows[i].message.content.filter((c) => c?.type === 'text').map((c) => c.text).join(''));

// ——— 2. the server's own lifecycle ———
const store = new LocalWorldStore(world);
let beat = null;
const toolPaths = new Map();
const lifecycle = new AgentLifecycleManager({
  repoRoot: REPO_ROOT,
  vendorCliPath: VENDOR_CLI,
  frameSink: (frame) => {
    if (beat && frame.type === 'agent_progress' && frame.landed === true && beat.released === null) beat.released = Date.now() - beat.t0;
  },
  eventSink: (source, event) => {
    if (source !== 'writer' || !beat) return;
    const now = Date.now() - beat.t0;
    if (event.type === 'turn_start') beat.steps += 1;
    if (event.type === 'tool_execution_start') {
      toolPaths.set(event.toolCallId, event.args?.path);
      beat.tools.push(event.toolName);
    }
    if (event.type === 'tool_execution_end') {
      if (event.isError) {
        beat.toolErrors += 1;
        const text = JSON.stringify(event.result?.content ?? event.result ?? '').slice(0, 300);
        beat.errorSamples.push(`${event.toolName}: ${text}`);
      }
      if (beat.firstLand === null && isLandingTool(event.toolName, toolPaths.get(event.toolCallId), event.isError)) beat.firstLand = now;
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      const content = Array.isArray(event.message.content) ? event.message.content : [];
      const thinking = content.filter((c) => c.type === 'thinking').reduce((n, c) => n + (c.thinking?.length ?? 0), 0);
      if (beat.firstThinking === null) beat.firstThinking = thinking;
      if (beat.firstStep === null) beat.firstStep = now;
      const u = event.message.usage ?? {};
      beat.requests.push({ input: u.input ?? 0, cacheRead: u.cacheRead ?? 0, output: u.output ?? 0 });
    }
    if (event.type === 'compaction_start') beat.compactionStart = now;
    if (event.type === 'compaction_end') {
      beat.compaction = { ms: now - (beat.compactionStart ?? now), ok: Boolean(event.result), tokensBefore: event.result?.tokensBefore ?? null };
    }
  },
});

const layerOf = (text) => {
  const m = /\[Current Layer\] (\S+)/.exec(text);
  return m ? m[1] : null;
};

const results = [];
let lastLayer = 'map';
try {
  for (const [n, request] of requests.entries()) {
    lastLayer = layerOf(request) ?? lastLayer;
    store.writeViewpoint({ layer: lastLayer, focus: null, selected: [], bagCount: 0 });
    beat = { n: FROM + n, request: request.replace(/\s+/g, ' ').slice(0, 60), t0: Date.now(), steps: 0, tools: [], toolErrors: 0, errorSamples: [], firstLand: null, released: null, firstThinking: null, firstStep: null, requests: [], compaction: null };
    let error = null;
    try {
      await lifecycle.submitWriter(world, request);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    beat.settled = Date.now() - beat.t0;
    // Compaction (if due) runs on the same queue after the beat: wait it out so
    // the next beat starts where a real player's would.
    const t1 = Date.now();
    await lifecycle.writerQueue;
    beat.afterSettle = Date.now() - t1;
    const stats = await lifecycle.getWriter()?.getSessionStats().catch(() => null);
    beat.contextAfter = stats?.contextUsage?.tokens ?? null;
    beat.thinking = (await lifecycle.getWriter()?.getState().catch(() => null))?.thinkingLevel ?? null;
    beat.error = error;
    beat.wait = beat.released ?? beat.settled; // what the player waits for: release (after) or settle (before)
    const { t0, compactionStart, ...row } = beat;
    results.push(row);
    console.log(`#${row.n} wait=${(row.wait / 1000).toFixed(1)}s settle=${(row.settled / 1000).toFixed(1)}s land=${row.firstLand === null ? '-' : (row.firstLand / 1000).toFixed(1) + 's'} steps=${row.steps} think1=${row.firstThinking ?? '-'} ctx=${row.requests[0]?.input ?? 0}+${row.requests[0]?.cacheRead ?? 0}cached${row.compaction ? ` compact=${(row.compaction.ms / 1000).toFixed(1)}s` : ''}${error ? ` ERROR ${error}` : ''} | ${row.request}`);
  }
} finally {
  await lifecycle.stopAll().catch(() => {});
  store.close();
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return null;
  const k = (s.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (k - lo);
};
const sec = (ms) => (ms === null ? null : Math.round(ms / 100) / 10);
const ok = results.filter((r) => !r.error);
const summary = {
  mode: MODE,
  beats: results.length,
  errors: results.length - ok.length,
  wait: { median: sec(pct(ok.map((r) => r.wait), 0.5)), p90: sec(pct(ok.map((r) => r.wait), 0.9)), max: sec(Math.max(...ok.map((r) => r.wait))) },
  settle: { median: sec(pct(ok.map((r) => r.settled), 0.5)), p90: sec(pct(ok.map((r) => r.settled), 0.9)) },
  firstLand: { median: sec(pct(ok.filter((r) => r.firstLand !== null).map((r) => r.firstLand), 0.5)), p90: sec(pct(ok.filter((r) => r.firstLand !== null).map((r) => r.firstLand), 0.9)) },
  steps: { median: pct(ok.map((r) => r.steps), 0.5), p90: pct(ok.map((r) => r.steps), 0.9), max: Math.max(...ok.map((r) => r.steps)) },
  firstThinkingChars: { median: pct(ok.map((r) => r.firstThinking ?? 0), 0.5) },
  readFirst: ok.filter((r) => ['read', 'look_at', 'ls', 'grep', 'find'].includes(r.tools[0])).length,
  compactions: results.filter((r) => r.compaction).map((r) => ({ beat: r.n, ms: r.compaction.ms, ok: r.compaction.ok, tokensBefore: r.compaction.tokensBefore })),
  contextFirst: results[0]?.requests[0] ? results[0].requests[0].input + results[0].requests[0].cacheRead : null,
  contextLast: results.at(-1)?.requests[0] ? results.at(-1).requests[0].input + results.at(-1).requests[0].cacheRead : null,
};
console.log(JSON.stringify(summary, null, 2));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2));
fs.rmSync(work, { recursive: true, force: true });
