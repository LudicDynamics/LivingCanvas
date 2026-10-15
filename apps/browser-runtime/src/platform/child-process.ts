// node:child_process. `spawn('node', [program, ...args])` starts a registered
// in-process program (the pi-rp CLI) with its own process object and a
// stdin/stdout pipe pair, so the caller's JSONL RPC is unchanged. Anything else
// (shells, git, ffmpeg) fails like a missing binary.
import { EventEmitter } from 'events';
import { PassThrough } from 'readable-stream';
import utilPkg from 'util';
import { NATIVE_TOOLS } from './native-tools';

const nativeTool = (cmd: string) => NATIVE_TOOLS[cmd.slice(cmd.lastIndexOf('/') + 1)];
function runNative(cmd: string, args: string[], cwd: string) {
  let stdout = '', stderr = '';
  const tool = nativeTool(cmd)!;
  const status = args[0] === '--version' ? ((stdout = `${cmd} 0.0.0 (browser mode, in-process)\n`), 0)
    : tool({ args, cwd, out: (s) => { stdout += s; }, err: (s) => { stderr += s; } });
  return { status, stdout, stderr };
}

export interface ProgramContext {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  pid: number;
  stdin: any;
  stdout: any;
  stderr: any;
  onExit: (code: number) => void;
}
export type Program = (ctx: ProgramContext) => Promise<{ kill: (signal: string) => void }>;

const programs = new Map<string, Program>();
export function registerProgram(path: string, program: Program) { programs.set(path, program); }

let nextPid = 1000;

function pipe() {
  const s: any = new PassThrough();
  s.isTTY = false;
  s.fd = -1;
  return s;
}

function enoent(cmd: string) {
  return Object.assign(new Error(`spawn ${cmd} ENOENT (browser mode has no external programs)`), { code: 'ENOENT', errno: -2, syscall: `spawn ${cmd}`, path: cmd });
}

export class ChildProcess extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;
  connected = false;
  stdin = pipe();
  stdout = pipe();
  stderr = pipe();
  stdio = [this.stdin, this.stdout, this.stderr];
  spawnfile = '';
  spawnargs: string[] = [];
  _kill: (signal: string) => void = () => {};
  kill(signal = 'SIGTERM') {
    if (this.exitCode !== null || this.signalCode !== null) return false;
    this.killed = true;
    this._kill(signal);
    return true;
  }
  _exited(code: number | null, signal: string | null) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    try { this.stdout.end(); this.stderr.end(); } catch { /* already ended */ }
    this.emit('exit', code, signal);
    queueMicrotask(() => this.emit('close', code, signal));
  }
  ref() { return this; }
  unref() { return this; }
  disconnect() {}
}

export function spawn(cmd: string, args: string[] = [], opts: any = {}) {
  if (!Array.isArray(args)) { opts = args ?? {}; args = []; }
  const cp = new ChildProcess();
  cp.spawnfile = cmd;
  cp.spawnargs = [cmd, ...args];
  const isNode = cmd === 'node' || cmd === process.execPath || /\/node$/.test(cmd);
  const program = isNode ? programs.get(args[0]) : undefined;
  if (!isNode && nativeTool(cmd)) {
    cp.pid = nextPid++;
    queueMicrotask(() => {
      cp.emit('spawn');
      let r;
      try { r = runNative(cmd, args, opts.cwd ?? process.cwd()); } catch (e: any) { r = { status: 2, stdout: '', stderr: `${cmd}: ${e?.message ?? e}\n` }; }
      if (r.stdout) cp.stdout.write(r.stdout);
      if (r.stderr) cp.stderr.write(r.stderr);
      setTimeout(() => cp._exited(r.status, null), 0);
    });
    return cp;
  }
  if (!program) {
    queueMicrotask(() => { cp.emit('error', enoent(isNode ? `node ${args[0]}` : cmd)); cp._exited(-2, null); });
    return cp;
  }
  cp.pid = nextPid++;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.env ?? process.env)) if (v !== undefined) env[k] = String(v);
  program({
    argv: ['node', args[0], ...args.slice(1)],
    env,
    cwd: opts.cwd ?? process.cwd(),
    pid: cp.pid,
    stdin: cp.stdin,
    stdout: cp.stdout,
    stderr: cp.stderr,
    onExit: (code) => cp._exited(code, null),
  }).then(
    (handle) => { cp._kill = (signal) => handle.kill(signal); cp.emit('spawn'); },
    (err) => { cp.stderr.write(String(err?.stack ?? err) + '\n'); cp.emit('error', err); cp._exited(1, null); },
  );
  return cp;
}

const fail = (what: string) => (cmd: string) => { throw enoent(`${what} ${cmd}`); };
export const exec = (cmd: string, _o?: unknown, cb?: any) => {
  const done = typeof _o === 'function' ? _o : cb;
  queueMicrotask(() => done?.(enoent(cmd), '', ''));
  return new ChildProcess();
};
/** execFile: in-process tools (fd, rg, zip, unzip) run; anything else is ENOENT. */
export function execFile(file: string, a?: unknown, o?: unknown, cb?: any) {
  const done = [a, o, cb].find((x) => typeof x === 'function') as any;
  const args = Array.isArray(a) ? (a as string[]) : [];
  const opts: any = [a, o].find((x) => x && typeof x === 'object' && !Array.isArray(x)) ?? {};
  const cp = new ChildProcess();
  queueMicrotask(() => {
    if (!nativeTool(file)) { done?.(enoent(file), '', ''); return; }
    let r;
    try { r = runNative(file, args, opts.cwd ?? process.cwd()); } catch (e: any) { r = { status: 2, stdout: '', stderr: `${file}: ${e?.message ?? e}\n` }; }
    const err = r.status === 0 ? null : Object.assign(new Error(`Command failed: ${file} ${args.join(' ')}\n${r.stderr}`), { code: r.status, stdout: r.stdout, stderr: r.stderr });
    done?.(err, r.stdout, r.stderr);
  });
  return cp;
}
// Node's execFile promisifies to { stdout, stderr }.
const execFilePromise = (file: string, args?: string[], opts?: any) => new Promise((resolve, reject) => {
  execFile(file, args, opts ?? {}, (err: any, stdout: string, stderr: string) => (err ? reject(err) : resolve({ stdout, stderr })));
});
for (const key of [(utilPkg as any).promisify?.custom, Symbol.for('nodejs.util.promisify.custom')]) if (key) (execFile as any)[key] = execFilePromise;
export const execSync = fail('execSync');
export const execFileSync = fail('execFileSync');
export const spawnSync = (cmd: string, args: string[] = [], opts: any = {}) => {
  if (!nativeTool(cmd)) return { pid: 0, status: null, signal: null, stdout: '', stderr: '', output: [], error: enoent(cmd) };
  const r = runNative(cmd, Array.isArray(args) ? args : [], opts?.cwd ?? process.cwd());
  const enc = (x: string) => (opts?.encoding && opts.encoding !== 'buffer' ? x : (globalThis as any).__airpNode.buffer.Buffer.from(x));
  return { pid: nextPid++, status: r.status, signal: null, stdout: enc(r.stdout), stderr: enc(r.stderr), output: [null, enc(r.stdout), enc(r.stderr)], error: undefined };
};
export const fork = fail('fork');
export default { spawn, exec, execFile, execSync, execFileSync, spawnSync, fork, ChildProcess, registerProgram };
