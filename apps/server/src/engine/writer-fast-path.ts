/**
 * The writer's fast path on the server:
 * one model call per player beat, beside or instead of the pi-rp agent loop.
 *
 *   AIRP_WRITER_FAST_PATH=off     (default) nothing changes.
 *   AIRP_WRITER_FAST_PATH=shadow  the agent answers as always; the same beat runs
 *                                 the fast path in the background — pack, one
 *                                 call, parse, validate — and only LOGS it
 *                                 (`.airpworld/fast-path.log`): timings, the
 *                                 reply, whether its ops are legal, and what the
 *                                 agent actually did. Never writes the world,
 *                                 never sends a frame.
 *   AIRP_WRITER_FAST_PATH=on      a play beat goes to the fast path: the chalk
 *                                 streams on the existing chalk lane
 *                                 (`chalk_writing` / `writer_delta` /
 *                                 `chalk_landed`), the ops run through the action
 *                                 service as the writer, and the beat falls back
 *                                 to the agent by §5's rules. Every beat is
 *                                 logged too; one the fast path answered also
 *                                 keeps its beat text (`request`): the writer's
 *                                 session never saw it, and the message drawer's
 *                                 history reads "what you asked the writer" from
 * there — so never prune it.
 *
 * Off for a world: `world.json` `writer.fastPath: false` (the author), or the
 * save's `.airpworld/settings.json` `writerFastPath: false` (the player).
 *
 * Player turns (world.json `clock.perTurns`): the beat was already counted where
 * it arrived (the WS `writer_prompt`, a player action's own hook); the fast
 * path's ops run as the WRITER, which is never a player turn — so a beat is
 * counted exactly once on either path (engine/player-turn.ts).
 *
 * Other knobs: AIRP_WRITER_FAST_PATH_MODEL (default deepseek-v4-flash),
 * AIRP_WRITER_FAST_PATH_MAX_CHARS (pack budget, default 60000 ≈ 24k tokens),
 * AIRP_WRITER_FAST_PATH_TIMEOUT_MS (default 20000).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildFastPathPack, parseFastReply, validateFastReply, landFastChalk, runFastOps, chalkTextExtractor,
  createActionService, settleTurnCursor, readerOfActor, FAST_PATH_REPAIR, layerDirOf,
  type FastPathPack, type FastReply, type FastOp, type FastOpResult, type FastValidation, type LocalWorldStore, type FastPathAskRecord,
} from '@airp/shared';
import { gatewayFetch, readAiGateway } from '../ai-gateway.js';
import { readWorldSettings } from './world-settings.js';
import { isAuthoringWorld } from '../world-workshop.js';

export type FastPathMode = 'off' | 'shadow' | 'on';

export function fastPathModeFromEnv(env: NodeJS.ProcessEnv = process.env): FastPathMode {
  const raw = (env.AIRP_WRITER_FAST_PATH ?? '').trim().toLowerCase();
  return raw === 'on' || raw === 'shadow' ? raw : 'off';
}

const numberEnv = (env: NodeJS.ProcessEnv, name: string, fallback: number): number => {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** World author or player turned it off for this save. Never throws. */
export function fastPathAllowed(worldRoot: string): { ok: true } | { ok: false; reason: string } {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(worldRoot, 'world.json'), 'utf8')) as Record<string, any>;
    if (manifest?.writer?.fastPath === false) return { ok: false, reason: 'world.json writer.fastPath is false' };
    if (isAuthoringWorld(worldRoot, manifest)) return { ok: false, reason: 'authoring world' };
  } catch {
    return { ok: false, reason: 'world.json unreadable' };
  }
  if (readWorldSettings(worldRoot).writerFastPath === false) return { ok: false, reason: 'save setting writerFastPath is false' };
  return { ok: true };
}

/**
 * §5.1 pre-route, by rule and at no cost: is this message a play beat the fast
 * path may take, and on which layer? Only the server's own beat texts qualify.
 */
export async function preRoute(store: LocalWorldStore, message: string): Promise<{ ok: true; layer: string } | { ok: false; reason: string }> {
  if (/\[Author Request\]/.test(message)) return { ok: false, reason: 'author request' };
  const play = /\[Player Request\]|\[Player Event\]|\[Quiet Beat\]/.test(message);
  if (!play) return { ok: false, reason: 'not a play beat' };
  let layer = /\[Current Layer\] (\S+)/.exec(message)?.[1]
    ?? /"layer":"([^"]+)"/.exec(message)?.[1]
    ?? null;
  if (!layer) {
    try { layer = store.readViewpoint()?.layer ?? null; } catch { layer = null; }
  }
  layer ??= 'map';
  const dir = layerDirOf(layer);
  if ((await store.statKind(`${dir}/README.md`)) !== 'file') return { ok: false, reason: `${layer} has no README (scene-init needed)` };
  const stub = await store.readFile(`${dir}/README.md`).then((t) => /^\s*stub\s*:\s*true/m.test(t.split(/^---\s*$/m)[1] ?? ''), () => false);
  if (stub) return { ok: false, reason: `${layer} is a stub` };
  for (const m of message.matchAll(/\]\(((?:world|player|characters)\/[^)\s]+)\)/g)) {
    const ref = m[1];
    const inPlace = ref.startsWith(`${dir}/`) && !ref.slice(dir.length + 1).includes('/');
    if (!inPlace && !ref.startsWith('player/')) return { ok: false, reason: `references ${ref} outside the place and the bag` };
  }
  return { ok: true, layer };
}

// ——————————————————————————————————————————————————————————————————————
// The model
// ——————————————————————————————————————————————————————————————————————
export interface FastEndpoint {
  baseUrl: string;
  apiKey: string;
  request: typeof fetch;
}

/** An own DeepSeek key first, else the Worldlines AI service (signed in, or the trial guest). */
export function fastEndpoint(env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch): FastEndpoint | null {
  const own = env.DEEPSEEK_API_KEY?.trim() ?? '';
  if (own) return { baseUrl: (env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(/\/+$/, ''), apiKey: own, request };
  const gateway = readAiGateway(env, { guest: true });
  if (!gateway) return null;
  return { baseUrl: gateway.base, apiKey: gateway.apiKey, request: (url, init) => gatewayFetch(gateway, String(url), init, request) };
}

export interface StreamResult {
  raw: string;
  usage: Record<string, unknown> | null;
  firstChalkMs: number | null;
  doneMs: number;
  chalkDone: boolean;
}

/** One streamed call (thinking off, json_object). `onChalk` gets each decoded slice of chalk.text. */
export async function streamFastCall(ep: FastEndpoint, a: { model: string; system: string; user: string; signal: AbortSignal; onChalk?: (fresh: string) => void; maxTokens?: number }): Promise<StreamResult> {
  const t0 = performance.now();
  const res = await ep.request(`${ep.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ep.apiKey}` },
    body: JSON.stringify({
      model: a.model,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.8,
      max_tokens: a.maxTokens ?? 1500,
      messages: [{ role: 'system', content: a.system }, { role: 'user', content: a.user }],
    }),
    signal: a.signal,
  });
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`model HTTP ${res.status}`);
  }
  const ex = chalkTextExtractor();
  const dec = new TextDecoder();
  let raw = '';
  let usage: Record<string, unknown> | null = null;
  let pending = '';
  let firstChalkMs: number | null = null;
  const reader = res.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let msg: { usage?: Record<string, unknown>; choices?: Array<{ delta?: { content?: string } }> };
      try { msg = JSON.parse(data); } catch { continue; }
      if (msg.usage) usage = msg.usage;
      const delta = msg.choices?.[0]?.delta?.content ?? '';
      if (!delta) continue;
      raw += delta;
      const fresh = ex.push(delta);
      if (fresh) {
        if (firstChalkMs === null) firstChalkMs = performance.now() - t0;
        a.onChalk?.(fresh);
      }
    }
  }
  return { raw, usage, firstChalkMs, doneMs: performance.now() - t0, chalkDone: ex.done };
}

async function repairCall(ep: FastEndpoint, a: { model: string; system: string; user: string; raw: string; refused: Array<{ op?: unknown; why: string }>; signal: AbortSignal }): Promise<{ ops: FastOp[]; ms: number }> {
  const t0 = performance.now();
  const res = await ep.request(`${ep.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ep.apiKey}` },
    body: JSON.stringify({
      model: a.model,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      max_tokens: 800,
      messages: [
        { role: 'system', content: a.system },
        { role: 'user', content: a.user },
        { role: 'assistant', content: a.raw },
        { role: 'user', content: `${FAST_PATH_REPAIR}\nRefused:\n${a.refused.map((r) => `- ${JSON.stringify(r.op ?? null)} → ${r.why}`).join('\n')}` },
      ],
    }),
    signal: a.signal,
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return { ops: [], ms: performance.now() - t0 };
  }
  const body = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
  let ops: FastOp[] = [];
  try {
    const parsed = JSON.parse(body?.choices?.[0]?.message?.content ?? '{}') as { ops?: unknown };
    ops = Array.isArray(parsed.ops) ? parsed.ops.filter((o): o is FastOp => !!o && typeof o === 'object' && typeof (o as FastOp).op === 'string') : [];
  } catch {
    ops = [];
  }
  return { ops, ms: performance.now() - t0 };
}

// ——————————————————————————————————————————————————————————————————————
// The log
// ——————————————————————————————————————————————————————————————————————
export const FAST_PATH_LOG = '.airpworld/fast-path.log';

export function appendFastPathLog(worldRoot: string, record: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.join(worldRoot, '.airpworld'), { recursive: true });
    fs.appendFileSync(path.join(worldRoot, FAST_PATH_LOG), `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
  } catch (err) {
    console.warn('[AIRP FastPath] log write failed:', err instanceof Error ? err.message : String(err));
  }
}

const opKey = (name: string, args: Record<string, unknown> | undefined): string => {
  const a = args ?? {};
  switch (name) {
    case 'choose': return `choose ${String(a.path ?? '')}#${String(a.option ?? a.choice ?? '')}`;
    case 'search': return `search ${String(a.spot ?? (a.improvise ? 'improvised' : ''))}`;
    case 'skill_check': return `skill_check ${String(a.skill ?? '')}${a.spot ? `@${String(a.spot)}` : ''}`;
    case 'use_item_on': return `use_item_on ${String(a.item ?? '')}→${String(a.target ?? '')}`;
    case 'trigger_keyword': return `trigger_keyword ${String(a.id ?? '')}`;
    default: return name;
  }
};

/** The agent's tool calls of one beat, in the same words as the fast ops (for the shadow comparison). */
export class AgentBeatRecorder {
  readonly startedAt = Date.now();
  firstChalkMs: number | null = null;
  doneMs: number | null = null;
  readonly tools: Array<{ name: string; key: string; isError?: boolean }> = [];
  private byId = new Map<string, number>();

  onEvent(event: { type: string; toolName?: string; toolCallId?: string; args?: unknown; isError?: boolean }): void {
    if (event.type === 'tool_execution_start' && event.toolName && event.toolCallId) {
      this.byId.set(event.toolCallId, this.tools.length);
      this.tools.push({ name: event.toolName, key: opKey(event.toolName, event.args as Record<string, unknown> | undefined) });
    } else if (event.type === 'tool_execution_end' && event.toolCallId) {
      const i = this.byId.get(event.toolCallId);
      if (i !== undefined) this.tools[i].isError = !!event.isError;
      if (event.toolName === 'chalk' && !event.isError && this.firstChalkMs === null) this.firstChalkMs = Date.now() - this.startedAt;
    } else if (event.type === 'agent_settled') {
      this.doneMs = Date.now() - this.startedAt;
    }
  }
}

// ——————————————————————————————————————————————————————————————————————
// One beat
// ——————————————————————————————————————————————————————————————————————
export interface FastBeatFrames {
  /** Raw WS frames on the existing chalk lane (savePath added by the caller). */
  frame(message: Record<string, unknown>): void;
  /** Synthetic engine events through the writer's normal sink (`agent_start` / `agent_settled`: dice settle, writer_idle). */
  event(event: { type: string; [key: string]: unknown }): void;
}

export interface FastBeatResult {
  /** True when the fast path answered this beat (the agent must not run). */
  handled: boolean;
  /** Why the beat went (or must go) to the agent. */
  fallback?: string;
  record: Record<string, unknown>;
}

export interface FastPathDeps {
  storeFor(worldRoot: string): LocalWorldStore | null;
  env?: NodeJS.ProcessEnv;
  request?: typeof fetch;
  log?: (line: string) => void;
}

/**
 * The server's fast path. One instance per process; per-world state is only
 * the §5.3 run-time degrade counter (two beats in a row in one place whose ops
 * were all refused → the next beat there goes to the agent).
 */
export class WriterFastPath {
  private refusedRun = new Map<string, number>();
  private aborts = new Map<string, { controller: AbortController; stopped: boolean }>();

  constructor(private readonly deps: FastPathDeps) {}

  private get env(): NodeJS.ProcessEnv { return this.deps.env ?? process.env; }

  mode(): FastPathMode { return fastPathModeFromEnv(this.env); }

  /** Stop the fast beat running for this world, if any. */
  abort(worldRoot: string): boolean {
    const c = this.aborts.get(worldRoot);
    if (!c) return false;
    c.stopped = true;
    c.controller.abort();
    return true;
  }

  running(worldRoot: string): boolean { return this.aborts.has(worldRoot); }

  /** The full gate: mode, world/save switches, endpoint, pre-route, the run-time degrade. */
  async gate(worldRoot: string, message: string): Promise<{ ok: true; store: LocalWorldStore; layer: string; endpoint: FastEndpoint } | { ok: false; reason: string }> {
    if (this.mode() === 'off') return { ok: false, reason: 'off' };
    const allowed = fastPathAllowed(worldRoot);
    if (!allowed.ok) return allowed;
    const store = this.deps.storeFor(worldRoot);
    if (!store) return { ok: false, reason: 'no active store' };
    const endpoint = fastEndpoint(this.env, this.deps.request ?? fetch);
    if (!endpoint) return { ok: false, reason: 'no model endpoint' };
    const routed = await preRoute(store, message).catch((err) => ({ ok: false as const, reason: `pre-route failed: ${(err as Error).message}` }));
    if (!routed.ok) return routed;
    const key = `${worldRoot}\u0000${routed.layer}`;
    if ((this.refusedRun.get(key) ?? 0) >= 2) {
      this.refusedRun.delete(key);
      return { ok: false, reason: 'two beats in a row here had every op refused' };
    }
    return { ok: true, store, layer: routed.layer, endpoint };
  }

  private model(): string { return this.env.AIRP_WRITER_FAST_PATH_MODEL?.trim() || 'deepseek-v4-flash'; }

  /**
   * Shadow: pack + one call + parse + validate, nothing written. Returns a
   * finisher that, given the agent's recorded beat, writes the log line.
   */
  async shadow(worldRoot: string, message: string): Promise<{ finish(agent: AgentBeatRecorder | null): Promise<void> } | null> {
    const gate = await this.gate(worldRoot, message);
    if (!gate.ok) {
      appendFastPathLog(worldRoot, { mode: 'shadow', beat: message.slice(0, 200), route: 'agent', fallback: gate.reason });
      return null;
    }
    const t0 = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), numberEnv(this.env, 'AIRP_WRITER_FAST_PATH_TIMEOUT_MS', 20000));
    const work = (async (): Promise<Record<string, unknown>> => {
      const record: Record<string, unknown> = { mode: 'shadow', beat: message.slice(0, 200), layer: gate.layer };
      try {
        const pack = await buildFastPathPack(gate.store, { layer: gate.layer, request: message });
        Object.assign(record, packStats(pack));
        if (pack.system.length + pack.user.length > numberEnv(this.env, 'AIRP_WRITER_FAST_PATH_MAX_CHARS', 60000)) {
          return { ...record, route: 'agent', fallback: 'pack over budget' };
        }
        const call = await streamFastCall(gate.endpoint, { model: this.model(), system: pack.system, user: pack.user, signal: controller.signal });
        Object.assign(record, { firstChalkMs: round(call.firstChalkMs), doneMs: round(call.doneMs), usage: call.usage });
        const reply = parseFastReply(call.raw);
        if ('error' in reply) return { ...record, route: 'agent', fallback: `parse: ${reply.error}`, raw: call.raw.slice(0, 2000) };
        const v = await validateFastReply(gate.store, pack, reply);
        return { ...record, ...replyRecord(reply, v), legal: { ok: v.ok.length, total: reply.ops.length } };
      } catch (err) {
        return { ...record, route: 'agent', fallback: `error: ${(err as Error).message}` };
      } finally {
        clearTimeout(timer);
        record.totalMs = round(performance.now() - t0);
      }
    })();
    return {
      finish: async (agent) => {
        const rec = await work;
        const fastOps = ((rec.ops as FastOp[] | undefined) ?? []).map((o) => opKey(o.op, o as Record<string, unknown>));
        const agentOps = agent ? agent.tools.filter((t) => !['read', 'look_at', 'view_canvas', 'grep', 'find', 'ls', 'get_component', 'chalk'].includes(t.name)).map((t) => t.key) : [];
        appendFastPathLog(worldRoot, {
          ...rec,
          agent: agent ? { firstChalkMs: agent.firstChalkMs, doneMs: agent.doneMs, steps: agent.tools.length, errors: agent.tools.filter((t) => t.isError).length, tools: agent.tools.map((t) => `${t.key}${t.isError ? ' ✗' : ''}`) } : null,
          compare: { fast: fastOps, agent: agentOps, same: fastOps.filter((k) => agentOps.includes(k)), fastOnly: fastOps.filter((k) => !agentOps.includes(k)), agentOnly: agentOps.filter((k) => !fastOps.includes(k)) },
        });
      },
    };
  }

  /**
   * On: answer this beat. `handled: false` means the agent must take it (nothing
   * of this beat reached the world, and any ink already on screen was taken back).
   */
  async run(worldRoot: string, message: string, out: FastBeatFrames, gated?: { store: LocalWorldStore; layer: string; endpoint: FastEndpoint }): Promise<FastBeatResult> {
    const gate = gated ? { ok: true as const, ...gated } : await this.gate(worldRoot, message);
    if (!gate.ok) return { handled: false, fallback: gate.reason, record: { mode: 'on', route: 'agent', fallback: gate.reason } };
    const { store, layer, endpoint } = gate;
    const t0 = performance.now();
    const record: Record<string, unknown> = { mode: 'on', beat: message.slice(0, 200), layer };
    const controller = new AbortController();
    const handle = { controller, stopped: false };
    this.aborts.set(worldRoot, handle);
    const timer = setTimeout(() => controller.abort(), numberEnv(this.env, 'AIRP_WRITER_FAST_PATH_TIMEOUT_MS', 20000));
    const toolCallId = `fast:${randomUUID()}`;
    const askedAt = new Date().toISOString();
    let inked = false;
    const takeBack = () => {
      if (!inked) return;
      out.frame({ type: 'tool_end', source: 'writer', toolName: 'chalk', toolCallId, isError: true });
    };
    let wrote = false;
    const finish = (result: FastBeatResult): FastBeatResult => {
      clearTimeout(timer);
      if (this.aborts.get(worldRoot) === handle) this.aborts.delete(worldRoot);
      result.record.totalMs = round(performance.now() - t0);
      // Answered here, so the writer's session never sees this beat: the log keeps
      // the beat text for the message drawer's history (rules/stream-history.ts
      // `streamItemsOfFastPathLog`). A beat handed to the agent keeps none — the
      // agent's session holds it — so a request is recorded exactly once.
      if (result.handled) result.record.request = { id: toolCallId, at: askedAt, message } satisfies FastPathAskRecord;
      appendFastPathLog(worldRoot, result.record);
      return result;
    };
    try {
      const pack = await buildFastPathPack(store, { layer, request: message });
      Object.assign(record, packStats(pack));
      if (pack.system.length + pack.user.length > numberEnv(this.env, 'AIRP_WRITER_FAST_PATH_MAX_CHARS', 60000)) {
        return finish({ handled: false, fallback: 'pack over budget', record: { ...record, route: 'agent', fallback: 'pack over budget' } });
      }
      out.event({ type: 'agent_start' });
      out.frame({ type: 'agent_progress', source: 'writer', stage: 'Writing the reply', startedAt: Date.now(), updatedAt: Date.now(), busy: true });
      let call: StreamResult;
      try {
        call = await streamFastCall(endpoint, {
          model: this.model(), system: pack.system, user: pack.user, signal: controller.signal,
          onChalk: (fresh) => {
            if (pack.quiet) return; // a quiet beat lands no chalk: never show ink
            if (!inked) {
              inked = true;
              out.frame({ type: 'chalk_writing', source: 'writer', toolCallId });
            }
            out.frame({ type: 'writer_delta', source: 'writer', delta: fresh, toolCallId });
          },
        });
      } catch (err) {
        takeBack();
        const why = controller.signal.aborted ? 'aborted or timed out' : `model: ${(err as Error).message}`;
        // A Stop is a stop: the agent does not pick the beat up.
        if (handle.stopped) {
          out.frame({ type: 'turn_aborted', source: 'writer', reason: 'aborted' });
          out.event({ type: 'agent_settled' });
          return finish({ handled: true, record: { ...record, route: 'fast', aborted: true } });
        }
        return finish({ handled: false, fallback: why, record: { ...record, route: 'agent', fallback: why } });
      }
      Object.assign(record, { firstChalkMs: round(call.firstChalkMs), streamMs: round(call.doneMs), usage: call.usage });
      const reply = parseFastReply(call.raw);
      let parsed: FastReply;
      if ('error' in reply) {
        // §3.4: chalk already streamed in full → land it, drop the ops; nothing streamed → the agent.
        if (!inked || !call.chalkDone) {
          takeBack();
          return finish({ handled: false, fallback: `parse: ${reply.error}`, record: { ...record, route: 'agent', fallback: `parse: ${reply.error}`, raw: call.raw.slice(0, 2000) } });
        }
        const text = chalkTextExtractor();
        text.push(call.raw);
        parsed = { route: 'fast', chalk: { text: text.text, options: [] }, ops: [], why: 'parse failed; chalk kept' };
      } else {
        parsed = reply;
      }
      if (parsed.route === 'agent') {
        takeBack();
        return finish({ handled: false, fallback: `model asked for the agent: ${parsed.why}`, record: { ...record, route: 'agent', fallback: 'model route agent', why: parsed.why } });
      }
      const v = await validateFastReply(store, pack, parsed);
      const svc = createActionService(store, { type: 'writer' }, { turn: `fast-path:${randomUUID()}`, agentScope: 'writer-top-level' });
      const tExec = performance.now();
      wrote = true;
      let chalkResult: FastOpResult | null = null;
      if (parsed.chalk) {
        chalkResult = await landFastChalk(svc, pack, parsed.chalk);
        if (chalkResult.ok) out.frame({ type: 'chalk_landed', source: 'writer', toolCallId, ...(chalkResult.path ? { path: chalkResult.path } : {}) });
        else takeBack();
      } else {
        takeBack();
      }
      // The page may act as soon as the chalk is down (perf/writer-turn: 落笔即放行).
      out.frame({ type: 'agent_progress', source: 'writer', stage: 'Chalk is ready · finishing world updates', updatedAt: Date.now(), busy: true, ...(chalkResult?.ok ? { landed: true } : {}) });
      const exec = await runFastOps(svc, pack, v.ok);
      const refused = [...v.problems.map((p) => ({ op: p.op, why: p.why })), ...exec.filter((r) => !r.ok).map((r) => ({ op: r.input, why: r.error ?? 'refused' }))];
      let repair: Record<string, unknown> | undefined;
      let repairedOk = 0;
      if (refused.length && !controller.signal.aborted) {
        const fixed = await repairCall(endpoint, { model: this.model(), system: pack.system, user: pack.user, raw: call.raw, refused, signal: controller.signal }).catch(() => ({ ops: [] as FastOp[], ms: 0 }));
        const v2 = await validateFastReply(store, pack, { route: 'fast', chalk: null, ops: fixed.ops, why: '' });
        const exec2 = await runFastOps(svc, pack, v2.ok);
        repairedOk = exec2.filter((r) => r.ok).length;
        repair = { ms: round(fixed.ms), ops: fixed.ops, problems: v2.problems.map((p) => p.why), exec: exec2 };
      }
      const okOps = exec.filter((r) => r.ok).length + repairedOk;
      const key = `${worldRoot}\u0000${layer}`;
      if (parsed.ops.length > 0 && okOps === 0) this.refusedRun.set(key, (this.refusedRun.get(key) ?? 0) + 1);
      else this.refusedRun.delete(key);
      // The writer read this beat: its cursor moves like an agent turn's (extensions/context.ts).
      await settleTurnCursor(store, readerOfActor({ type: 'writer' }), { advance: true }).catch(() => {});
      Object.assign(record, replyRecord(parsed, v), {
        route: 'fast',
        chalk: chalkResult,
        exec,
        ...(repair ? { repair } : {}),
        execMs: round(performance.now() - tExec),
        legal: { ok: okOps, total: parsed.ops.length },
      });
      out.frame({ type: 'agent_progress', source: 'writer', stage: 'Ready', updatedAt: Date.now(), busy: false });
      out.event({ type: 'agent_settled' });
      return finish({ handled: true, record });
    } catch (err) {
      takeBack();
      const why = `error: ${(err as Error).message}`;
      // Something already reached the world: the beat is this path's, never run twice.
      if (wrote) {
        out.event({ type: 'agent_settled' });
        return finish({ handled: true, record: { ...record, route: 'fast', error: why } });
      }
      return finish({ handled: false, fallback: why, record: { ...record, route: 'agent', fallback: why } });
    }
  }

}

const round = (ms: number | null | undefined): number | null => (typeof ms === 'number' ? Math.round(ms) : null);

function packStats(pack: FastPathPack): Record<string, unknown> {
  return {
    packChars: { system: pack.system.length, user: pack.user.length },
    buildMs: round(pack.buildMs),
    previews: pack.previews.map((p) => `${p.path}#${p.preview.option.id ?? p.preview.option.index} ${p.preview.verdict}`),
  };
}

function replyRecord(reply: FastReply, v: FastValidation): Record<string, unknown> {
  return {
    reply: { chalk: reply.chalk ? { title: reply.chalk.title ?? '', text: reply.chalk.text, options: reply.chalk.options ?? [] } : null, why: reply.why },
    ops: reply.ops,
    problems: v.problems.map((p) => ({ op: p.op, why: p.why })),
    fixes: v.fixes,
    warnings: v.warnings,
  };
}
