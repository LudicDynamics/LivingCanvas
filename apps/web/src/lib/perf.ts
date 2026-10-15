// Load / play timings behind a debug flag: `?perf=1` (this load) or localStorage `airp.perf` = '1'.
// Off by default; when off every function here is a no-op and nothing is patched. Nothing is sent
// anywhere (no analytics events): the numbers live in `window.__airpPerf` and print as a console table
// once the lobby shows and after every timed step. Read by apps/browser-runtime/e2e/perf-site.mjs.
//
//   marks   page milestones (ms since navigation): bundle start, SW ready, worker created, runtime ready,
//           app rendered, lobby visible
//   api     /api calls slower than 30 ms (worlds/load = open world, enter-layer, …), with their duration
//   turns   writer_prompt / character_prompt → first delta → done, plus (browser mode) the Worker's model
//           requests during the turn: n, time to headers, total, and "other" = turn − model time
//           (the in-tab server, pi and the tools)
//   worker  the Worker's boot marks and the files it fetched (server.js, pi.js, sqlite3.wasm, …)

const enabled = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get('perf');
    if (q !== null) return q !== '0';
    return localStorage.getItem('airp.perf') === '1';
  } catch { return false; }
})();

export const perfEnabled = () => enabled;

type Turn = { kind: string; start: number; first: number | null; done: number | null; model?: unknown };
const state = {
  marks: {} as Record<string, number>,
  api: [] as { path: string; ms: number; at: number }[],
  turns: [] as Turn[],
  worker: null as unknown,
  /** Main-thread long tasks (> 50 ms): [start, duration] in page ms, the last 100. */
  longTasks: [] as [number, number][],
};
const now = () => Math.round(performance.now());

export function perfMark(name: string) {
  if (!enabled || state.marks[name] !== undefined) return;
  state.marks[name] = now();
}

type RuntimeLike = { stats: () => Promise<{ stats?: Record<string, unknown>; marks?: unknown }> };
const runtime = () => (window as unknown as { __airpRuntime?: RuntimeLike }).__airpRuntime ?? null;

async function workerSnapshot() {
  const rt = runtime();
  if (!rt) return null;
  try {
    const s = await rt.stats();
    return { marks: s.marks, files: s.stats?.files, worlds: s.stats?.worlds, model: s.stats?.model };
  } catch { return null; }
}

/** Model requests the Worker made inside [from, to] (page ms). The Worker stamps them in epoch ms (its clock starts later). */
function modelSplit(model: unknown, from: number, to: number) {
  const reqs = (Array.isArray(model) ? model : []) as { at: number; headersMs: number; ms: number; path: string }[];
  const inTurn = reqs.map((r) => ({ ...r, at: r.at - performance.timeOrigin })).filter((r) => r.at >= from - 5 && r.at <= to);
  // Union of the request intervals: model time; the rest of the turn is the in-tab server, pi and tools.
  let busy = 0, end = -Infinity;
  for (const r of [...inTurn].sort((a, b) => a.at - b.at)) {
    const s = Math.max(r.at, end), e = r.at + r.ms;
    if (e > s) busy += e - s;
    end = Math.max(end, e);
  }
  return {
    requests: inTurn.length,
    headersMs: inTurn.reduce((n, r) => n + r.headersMs, 0),
    modelMs: Math.round(busy),
    otherMs: Math.round(to - from - busy),
  };
}

function rows() {
  const out: Record<string, string | number>[] = [];
  const m = state.marks;
  for (const [k, v] of Object.entries(m)) out.push({ step: k, ms: v });
  for (const a of state.api) out.push({ step: `api ${a.path}`, ms: a.ms });
  for (const t of state.turns) {
    const split = t.model as ReturnType<typeof modelSplit> | undefined;
    out.push({
      step: `turn ${t.kind}`,
      ms: t.done !== null ? t.done - t.start : -1,
      first: t.first !== null ? t.first - t.start : -1,
      ...(split ? { modelReqs: split.requests, modelHeaders: split.headersMs, model: split.modelMs, other: split.otherMs } : {}),
    });
  }
  return out;
}

function print(label: string) {
  console.info(`[perf] ${label}`);
  console.table(rows());
}

async function refreshWorker() {
  const w = await workerSnapshot();
  if (w) state.worker = w;
  return w;
}

/** /api calls slower than 30 ms, by method + path (no query: it may carry ids). */
function patchFetch() {
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let path = '';
    try { path = new URL(url, window.location.href).pathname; } catch { /* not a URL */ }
    if (!path.includes('/api/')) return orig(input, init);
    const t = performance.now();
    const r = await orig(input, init);
    const ms = Math.round(performance.now() - t);
    if (ms > 30) {
      state.api.push({ path: `${(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()} ${path.slice(path.indexOf('/api/'))}`, ms, at: Math.round(t) });
      if (state.api.length > 200) state.api.shift();
      if (/\/api\/(worlds\/load|enter-layer)$/.test(path)) void refreshWorker().then(() => print(path));
    }
    return r;
  };
}

const PROMPTS: Record<string, string> = { writer_prompt: 'writer', character_prompt: 'character' };
let open: Turn | null = null;

/** A command went out on the canvas socket (lib/airp-gateway.ts sendSocket). */
export function perfSocketSend(type: unknown) {
  if (!enabled || typeof type !== 'string' || !PROMPTS[type]) return;
  open = { kind: PROMPTS[type], start: now(), first: null, done: null };
  state.turns.push(open);
}

/** A frame came in on the canvas socket. */
export function perfSocketFrame(type: unknown) {
  if (!enabled || !open || typeof type !== 'string') return;
  const t = open;
  if (t.first === null && type === `${t.kind}_delta`) t.first = now();
  const finished = t.kind === 'writer' ? type === 'writer_idle' : type === 'character_message' || type === 'character_idle';
  if (finished && t.done === null) {
    t.done = now();
    open = null;
    void refreshWorker().then((w) => {
      if (w) t.model = modelSplit((w as { model?: unknown }).model, t.start, t.done!);
      print(`${t.kind} turn`);
    });
  }
}

function watchLobby() {
  const seen = () => !!document.querySelector('.world-launcher__hit');
  if (seen()) { perfMark('lobbyVisible'); return; }
  const mo = new MutationObserver(() => {
    if (!seen()) return;
    mo.disconnect();
    perfMark('lobbyVisible');
    void refreshWorker().then(() => print('lobby visible'));
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}

if (enabled) {
  perfMark('bundleStart');
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) state.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]);
      if (state.longTasks.length > 100) state.longTasks.splice(0, state.longTasks.length - 100);
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* no long-task timing in this browser */ }
  patchFetch();
  watchLobby();
  (window as unknown as { __airpPerf: unknown }).__airpPerf = {
    state,
    rows,
    print: () => print('now'),
    refresh: refreshWorker,
    table: () => rows().map((r) => Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' ')).join('\n'),
  };
}
