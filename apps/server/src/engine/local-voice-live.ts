import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { remoteConfigFile } from '../sync/remote-client.js';
import { resolveVoiceLiveUrl } from './voice-provider.js';

/**
 * The local edition's own voice-live, modelled on Sense
 * (Sense the design notes, app/src-tauri/src/voice.rs).
 *
 * Machine-specific things — where the voice-live checkout is, which `uv`, which
 * keys — live in a machine-local `voice.json`, never in the repository:
 *
 *   ~/.config/airp/voice.json   (beside remote.json / guest.json; AIRP_VOICE_CONFIG overrides)
 *   {"dir": "/path/to/voice-live", "uv": "/opt/homebrew/bin/uv", "port": 8777,
 *    "env": {"VOICE_LIVE_ASR": "fish", "VOICE_LIVE_TTS": "fish", ...}}
 *
 * At server start, when voice.json exists: something already healthy on the
 * port → reuse it (never ours to stop); otherwise spawn
 * `uv run python -m voice_live` in `dir` with `env`, in its own process group,
 * stdout/stderr appended to `voice-live.log` beside voice.json. On shutdown only
 * the child THIS server started is stopped (SIGTERM to the group, SIGKILL after
 * a grace period). An env VALUE is never logged and never sent to a page: the
 * keys are the user's own.
 *
 * Off entirely when `AIRP_LOCAL_VOICE_LIVE=0` (the browser build's in-tab
 * server sets it: there is no local process there) or when the call does not
 * go to the local default (an explicit `VOICE_LIVE_URL`, or tickets).
 */

export const DEFAULT_LOCAL_VOICE_LIVE_PORT = 8777;
/** How long a spawned voice-live gets to answer /healthz (first start loads models). */
export const LOCAL_VOICE_LIVE_START_TIMEOUT_MS = 120_000;
/** SIGTERM → SIGKILL grace on shutdown. */
export const LOCAL_VOICE_LIVE_STOP_GRACE_MS = 3_000;

export interface LocalVoiceConf {
  dir: string;
  uv: string;
  port: number;
  env: Record<string, string>;
}

export type LocalVoiceLiveState = 'off' | 'starting' | 'ready' | 'failed';

/** What the page may learn (`/api/live/config` → `localVoiceLive`): no path, no port, no env. */
export interface LocalVoiceLiveStatus {
  state: LocalVoiceLiveState;
  /** voice.json exists and parses. */
  configured: boolean;
  /** This server started the process (and will stop it). */
  owned: boolean;
  reason?: string;
}

export class VoiceConfError extends Error {}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Where voice.json lives: beside remote.json (`~/.config/airp/`), or `AIRP_VOICE_CONFIG`. */
export function voiceConfigFile(env: NodeJS.ProcessEnv = process.env): string {
  const declared = (env.AIRP_VOICE_CONFIG ?? '').trim();
  return declared ? path.resolve(declared) : path.join(path.dirname(remoteConfigFile()), 'voice.json');
}

/** The log a spawned voice-live writes to: beside voice.json. */
export function voiceLiveLogFile(configFile: string): string {
  return path.join(path.dirname(configFile), 'voice-live.log');
}

const expandHome = (p: string, home: string) => (p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p);

/**
 * Pure: parse voice.json. Errors name the field, never a value (a value may be a key).
 * `port` falls back to `env.VOICE_LIVE_PORT`, then 8777; `uv` to `uv` on PATH.
 */
export function parseVoiceConf(text: string, home: string = os.homedir()): LocalVoiceConf {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new VoiceConfError('voice.json is not valid JSON'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new VoiceConfError('voice.json must be a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.dir !== 'string' || !o.dir.trim()) throw new VoiceConfError('voice.json needs "dir" (the voice-live checkout)');
  const dir = expandHome(o.dir.trim(), home);
  if (!path.isAbsolute(dir)) throw new VoiceConfError('voice.json "dir" must be an absolute path');
  if (o.uv !== undefined && (typeof o.uv !== 'string' || !o.uv.trim())) throw new VoiceConfError('voice.json "uv" must be a path');
  const uv = typeof o.uv === 'string' ? expandHome(o.uv.trim(), home) : 'uv';
  const env: Record<string, string> = {};
  if (o.env !== undefined) {
    if (!o.env || typeof o.env !== 'object' || Array.isArray(o.env)) throw new VoiceConfError('voice.json "env" must be an object');
    for (const [k, v] of Object.entries(o.env as Record<string, unknown>)) {
      if (!ENV_KEY.test(k)) throw new VoiceConfError(`voice.json env name ${JSON.stringify(k.slice(0, 40))} is not a variable name`);
      if (typeof v !== 'string') throw new VoiceConfError(`voice.json env ${k} must be a string`);
      env[k] = v;
    }
  }
  const portRaw = o.port ?? (env.VOICE_LIVE_PORT ? Number(env.VOICE_LIVE_PORT) : DEFAULT_LOCAL_VOICE_LIVE_PORT);
  const port = typeof portRaw === 'number' ? portRaw : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new VoiceConfError('voice.json "port" must be a port number');
  return { dir, uv, port, env };
}

/** Variables passed through from this server to voice-live; everything else comes from voice.json. */
const PASS_THROUGH = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'UV_CACHE_DIR'];

/**
 * Pure: the spawn command for one conf. Our own environment is NOT inherited
 * wholesale (it carries the canvas's keys and session paths) — only the basics
 * uv needs, then voice.json's env, then the port/host this server will probe.
 */
export function voiceLiveSpawnSpec(conf: LocalVoiceConf, parentEnv: NodeJS.ProcessEnv = process.env): {
  command: string; args: string[]; cwd: string; env: Record<string, string>;
} {
  const env: Record<string, string> = {};
  for (const k of PASS_THROUGH) { const v = parentEnv[k]; if (typeof v === 'string') env[k] = v; }
  Object.assign(env, conf.env);
  env.VOICE_LIVE_PORT = String(conf.port);
  env.VOICE_LIVE_HOST ||= '127.0.0.1';
  return { command: conf.uv, args: ['run', 'python', '-m', 'voice_live'], cwd: conf.dir, env };
}

/** Pure: replace every env value of the conf (6+ chars) in a text with `***` before it is shown anywhere. */
export function redactConfValues(text: string, conf: Pick<LocalVoiceConf, 'env'> | null): string {
  if (!conf) return text;
  let out = text;
  for (const v of Object.values(conf.env)) if (v.length >= 6) out = out.split(v).join('***');
  return out;
}

/** Whether calls go to this server's local voice-live at all (not a declared URL, not tickets, not a tab). */
export function localVoiceLiveInEffect(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.AIRP_LOCAL_VOICE_LIVE ?? '').trim() === '0') return false;
  if ((env.VOICE_LIVE_URL ?? '').trim()) return false;
  if ((env.VOICE_LIVE_TICKETS_URL ?? '').trim()) return false;
  return true;
}

/** GET http://127.0.0.1:<port>/healthz → 200 within `timeoutMs`. */
export function probeHealthz(port: number, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/** A TCP connect to 127.0.0.1:<port> succeeds (something listens, healthy or not). */
export function probeListening(port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const done = (ok: boolean) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

export interface LocalVoiceLiveDeps {
  env?: NodeJS.ProcessEnv;
  configFile?: string;
  readFile?: (file: string) => string | null;
  healthy?: (port: number) => Promise<boolean>;
  listening?: (port: number) => Promise<boolean>;
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  /** Opens the log for appending; returns an fd (or 'ignore' when it cannot). */
  openLog?: (file: string) => number | 'ignore';
  closeLog?: (fd: number) => void;
  readLogTail?: (file: string) => string;
  /** process.kill: negative pid = the whole group. */
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  sleep?: (ms: number) => Promise<void>;
  startTimeoutMs?: number;
  stopGraceMs?: number;
  pollMs?: number;
  log?: (line: string) => void;
}

export interface LocalVoiceLive {
  /** Background start when voice.json exists (never throws, never awaited by the caller). */
  boot(): void;
  /** Reuse or spawn, single-flight; resolves with the status when settled. */
  ensure(): Promise<LocalVoiceLiveStatus>;
  /** Re-reads voice.json and re-probes when not ours / not starting (a hand-started voice-live counts). */
  refresh(): Promise<LocalVoiceLiveStatus>;
  status(): LocalVoiceLiveStatus;
  /** The configured port's URL (http://127.0.0.1:<port>), or null when not configured. */
  url(): string | null;
  /** voice.json's env says VOICE_LIVE_TTS=fish (the cast then picks Fish voices). */
  speaksFish(): boolean;
  /** Stop the child this server started (and only that). */
  stop(): Promise<void>;
  /** Synchronous last-resort for process 'exit': SIGTERM the group we own. */
  stopSync(): void;
}

function defaultReadFile(file: string): string | null {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function defaultOpenLog(file: string): number | 'ignore' {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    return fs.openSync(file, 'a', 0o600);
  } catch { return 'ignore'; }
}

function defaultReadLogTail(file: string): string {
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, 4096);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

export function createLocalVoiceLive(deps: LocalVoiceLiveDeps = {}): LocalVoiceLive {
  const env = deps.env ?? process.env;
  const configFile = deps.configFile ?? voiceConfigFile(env);
  const logFile = voiceLiveLogFile(configFile);
  const readFile = deps.readFile ?? defaultReadFile;
  const healthy = deps.healthy ?? ((p: number) => probeHealthz(p));
  const listening = deps.listening ?? ((p: number) => probeListening(p));
  const spawn = deps.spawn ?? nodeSpawn;
  const openLog = deps.openLog ?? defaultOpenLog;
  const closeLog = deps.closeLog ?? ((fd: number) => { try { fs.closeSync(fd); } catch { /* already closed */ } });
  const readLogTail = deps.readLogTail ?? defaultReadLogTail;
  const kill = deps.kill ?? ((pid: number, sig: NodeJS.Signals) => { process.kill(pid, sig); });
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const startTimeoutMs = deps.startTimeoutMs ?? LOCAL_VOICE_LIVE_START_TIMEOUT_MS;
  const stopGraceMs = deps.stopGraceMs ?? LOCAL_VOICE_LIVE_STOP_GRACE_MS;
  const pollMs = deps.pollMs ?? 500;
  const log = deps.log ?? ((line: string) => console.log(`[AIRP VoiceLive] ${line}`));
  const enabled = (env.AIRP_LOCAL_VOICE_LIVE ?? '').trim() !== '0';

  let conf: LocalVoiceConf | null = null;
  let confError: string | null = null;
  let state: LocalVoiceLiveState = 'off';
  let reason: string | undefined;
  let child: ChildProcess | null = null;
  let childExited = false;
  let stopping = false;
  let inflight: Promise<LocalVoiceLiveStatus> | null = null;

  const set = (s: LocalVoiceLiveState, r?: string) => { state = s; reason = r; };
  const snapshot = (): LocalVoiceLiveStatus => ({
    state,
    configured: conf !== null,
    owned: child !== null && !childExited,
    ...(reason ? { reason } : {}),
  });

  function loadConf(): LocalVoiceConf | null {
    if (!enabled) { conf = null; confError = null; return null; }
    const text = readFile(configFile);
    if (text === null) { conf = null; confError = null; return null; }
    try { conf = parseVoiceConf(text); confError = null; } catch (e) {
      conf = null;
      confError = e instanceof VoiceConfError ? e.message : 'voice.json could not be read';
    }
    return conf;
  }

  function tailReason(code: number | null, signal: NodeJS.Signals | null): string {
    const lines = readLogTail(logFile).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-2).join(' / ');
    const how = signal ? `signal ${signal}` : `code ${code}`;
    const tail = redactConfValues(lines, conf).slice(-240);
    return `voice-live exited (${how})${tail ? `: ${tail}` : ''} — see voice-live.log`;
  }

  function spawnChild(c: LocalVoiceConf): void {
    const spec = voiceLiveSpawnSpec(c, env);
    const fd = openLog(logFile);
    if (typeof fd === 'number') {
      try { fs.writeSync(fd, `\n--- ${new Date().toISOString()} canvas starts voice-live (port ${c.port}) ---\n`); } catch { /* best effort */ }
    }
    let ch: ChildProcess;
    try {
      ch = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        detached: true, // its own process group: uv and the python under it stop together
        stdio: ['ignore', fd, fd],
      });
    } finally {
      if (typeof fd === 'number') closeLog(fd);
    }
    child = ch;
    childExited = false;
    ch.unref?.();
    ch.once('error', (err: NodeJS.ErrnoException) => {
      if (child !== ch) return;
      childExited = true;
      set('failed', err.code === 'ENOENT' ? `cannot run voice-live: ${path.basename(spec.command)} not found (voice.json "uv")` : `cannot run voice-live (${err.code ?? err.name})`);
    });
    ch.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (child !== ch) return;
      childExited = true;
      if (stopping) return; // we asked it to go
      if (state === 'starting' || state === 'ready') set('failed', tailReason(code, signal));
    });
    // The pid only: the command line carries no secrets, but the env does and is never printed.
    log(`spawned voice-live pid=${ch.pid ?? '?'} in ${spec.cwd} (log: ${logFile})`);
  }

  async function run(): Promise<LocalVoiceLiveStatus> {
    const c = loadConf();
    if (!c) { set(confError ? 'failed' : 'off', confError ?? undefined); return snapshot(); }
    if (await healthy(c.port)) {
      set('ready');
      return snapshot();
    }
    const ours = child !== null && !childExited;
    if (await listening(c.port)) {
      if (!ours) {
        set('failed', 'the voice-live port is taken by a process this app did not start and it does not answer /healthz');
        return snapshot();
      }
      log('own voice-live is listening but not healthy; restarting it');
      await stop();
    }
    if (!(child !== null && !childExited)) {
      set('starting');
      spawnChild(c);
    } else {
      set('starting');
    }
    const until = Date.now() + startTimeoutMs;
    while (Date.now() < until) {
      if (childExited) return snapshot(); // the exit/error handler wrote the reason
      if (await healthy(c.port)) { set('ready'); log('voice-live ready'); return snapshot(); }
      await sleep(pollMs);
    }
    set('failed', `voice-live did not answer within ${Math.round(startTimeoutMs / 1000)}s — see voice-live.log`);
    return snapshot();
  }

  function ensure(): Promise<LocalVoiceLiveStatus> {
    if (!inflight) inflight = run().finally(() => { inflight = null; });
    return inflight;
  }

  async function stop(): Promise<void> {
    const ch = child;
    if (!ch || childExited || !ch.pid) { child = null; return; }
    const pid = ch.pid;
    const exited = new Promise<void>((r) => { if (childExited) r(); else ch.once('exit', () => r()); });
    stopping = true;
    try {
      try { kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
      const graceful = await Promise.race([exited.then(() => true), sleep(stopGraceMs).then(() => false)]);
      if (!graceful && !childExited) {
        try { kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    } finally {
      stopping = false;
    }
    if (child === ch) { child = null; childExited = false; }
    set('off');
  }

  return {
    boot() {
      if (!loadConf()) { if (confError) set('failed', confError); return; }
      void ensure().catch((e) => set('failed', e instanceof Error ? e.message : 'voice-live failed to start'));
    },
    ensure,
    async refresh() {
      if (!enabled) { set('off'); return snapshot(); }
      if (inflight) return snapshot();
      if (child !== null && !childExited) return snapshot();
      const c = loadConf();
      if (!c && confError) { set('failed', confError); return snapshot(); }
      // No voice.json: one started by hand on the default port still counts (never ours to stop).
      if (await healthy(c?.port ?? DEFAULT_LOCAL_VOICE_LIVE_PORT)) set('ready');
      else if (state === 'ready' || !c) set('off');
      return snapshot();
    },
    status: snapshot,
    url() {
      const c = conf ?? loadConf();
      return c ? `http://127.0.0.1:${c.port}` : null;
    },
    speaksFish() {
      const c = conf ?? loadConf();
      return (c?.env.VOICE_LIVE_TTS ?? '').trim() === 'fish';
    },
    stop,
    stopSync() {
      if (child && !childExited && child.pid) { try { kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } }
    },
  };
}

/** The voice-live base URL a call uses: this computer's (voice.json port) when in effect, else VOICE_LIVE_URL / the default. */
export function effectiveVoiceLiveUrl(sup: LocalVoiceLive | null | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return (sup && localVoiceLiveInEffect(env) ? sup.url() : null) ?? resolveVoiceLiveUrl(env);
}
