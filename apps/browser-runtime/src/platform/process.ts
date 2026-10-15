// A Node-shaped `process` object. The Worker's main process (the AIRP server)
// and every in-process "child" (a pi-rp CLI instance) each get their own, so
// argv / env / cwd / stdio / exit stay per program exactly like real processes.
import { EventEmitter } from 'events';
import { PassThrough, Writable } from 'readable-stream';

export class ProcessExit extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExit';
  }
}

export interface ProcessInit {
  argv?: string[];
  env?: Record<string, string>;
  cwd?: string;
  pid?: number;
  title?: string;
  stdin?: any;
  stdout?: any;
  stderr?: any;
  /** Called once when the program calls process.exit(). */
  onExit?: (code: number) => void;
}

const t0 = performance.now();
let nextPid = 100;

function consoleSink(write: (s: string) => void) {
  let buf = '';
  const w = new Writable({
    write(chunk: any, _enc: any, cb: () => void) {
      buf += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { write(buf.slice(0, i)); buf = buf.slice(i + 1); }
      cb();
    },
  }) as any;
  w.isTTY = false;
  w.columns = 120;
  w.rows = 40;
  w.fd = 1;
  return w;
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

export function createProcess(init: ProcessInit = {}, target?: any): any {
  // `target` lets the Worker upgrade the early global process object in place,
  // so modules that captured it before boot keep a valid reference.
  const ee: any = target ?? new EventEmitter();
  if (target) { Object.setPrototypeOf(target, EventEmitter.prototype); (EventEmitter as any).call(target); }
  ee.setMaxListeners(100);
  let cwd = init.cwd ?? '/';
  const stdin = init.stdin ?? Object.assign(new PassThrough(), { isTTY: false, fd: 0 });
  const stdout = init.stdout ?? consoleSink((s) => console.log(s));
  const stderr = init.stderr ?? consoleSink((s) => console.warn(s));
  let exited = false;
  const proc: any = Object.assign(ee, {
    title: init.title ?? 'node',
    argv: init.argv ?? ['node', '/app.js'],
    argv0: 'node',
    execArgv: [],
    execPath: '/usr/local/bin/node',
    env: { ...(init.env ?? {}) },
    pid: init.pid ?? nextPid++,
    ppid: 1,
    platform: 'linux',
    arch: 'x64',
    version: 'v22.12.0',
    versions: { node: '22.12.0', v8: '12.4', uv: '1.48', modules: '127' },
    release: { name: 'node' },
    features: {},
    config: { variables: {} },
    exitCode: undefined as number | undefined,
    stdin,
    stdout,
    stderr,
    browser: false,
    cwd: () => cwd,
    chdir: (d: string) => { cwd = d; },
    umask: () => 0o022,
    getuid: () => 1000,
    getgid: () => 1000,
    geteuid: () => 1000,
    getegid: () => 1000,
    kill: () => true,
    abort: () => { throw new ProcessExit(134); },
    nextTick: (fn: (...a: any[]) => void, ...args: any[]) => queueMicrotask(() => fn(...args)),
    emitWarning: () => {},
    binding: () => { throw new Error('process.binding is not supported in browser mode'); },
    cpuUsage: () => ({ user: 0, system: 0 }),
    resourceUsage: () => ({}),
    memoryUsage: Object.assign(() => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }), { rss: () => 0 }),
    uptime: () => (performance.now() - t0) / 1000,
    hrtime: Object.assign(
      (prev?: [number, number]) => {
        const ns = Math.round(performance.now() * 1e6);
        const s = Math.floor(ns / 1e9), n = ns % 1e9;
        if (!prev) return [s, n];
        let ds = s - prev[0], dn = n - prev[1];
        if (dn < 0) { ds -= 1; dn += 1e9; }
        return [ds, dn];
      },
      { bigint: () => BigInt(Math.round(performance.now() * 1e6)) },
    ),
    loadEnvFile: (file = '.env') => {
      const fs = (globalThis as any).__airpNode?.fs;
      const abs = file.startsWith('/') ? file : `${cwd.replace(/\/$/, '')}/${file}`;
      const vars = parseEnvFile(fs.readFileSync(abs, 'utf8'));
      for (const [k, v] of Object.entries(vars)) if (proc.env[k] === undefined) proc.env[k] = v;
    },
    exit: (code?: number) => {
      const c = code ?? proc.exitCode ?? 0;
      if (!exited) {
        exited = true;
        try { ee.emit('exit', c); } catch { /* exit listeners must not block exit */ }
        init.onExit?.(c);
      }
      throw new ProcessExit(c);
    },
    get exited() { return exited; },
  });
  return proc;
}
