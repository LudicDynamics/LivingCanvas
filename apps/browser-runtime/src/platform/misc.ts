// Small node:* modules: os, url, module, util, tty, assert, readline, async_hooks,
// perf_hooks, diagnostics_channel, timers, worker_threads, v8, vm, and the
// network / compression modules that browser mode does not provide (they throw
// on use, never on import).
import utilPkg from 'util';
import urlPkg from 'url';
import { EventEmitter } from 'events';
import { gunzipSync, gzipSync, inflateSync, deflateSync, inflateSync as inflateRawSync, deflateSync as deflateRawSync } from 'fflate';
import { Buffer } from 'buffer';

const unsupported = (what: string) => () => {
  throw Object.assign(new Error(`${what} is not available in browser mode`), { code: 'ERR_BROWSER_MODE' });
};

// ——— os ———
export const os = {
  homedir: () => '/home/web',
  tmpdir: () => '/tmp',
  hostname: () => 'browser',
  platform: () => 'linux',
  type: () => 'Linux',
  release: () => '6.0.0',
  arch: () => 'x64',
  machine: () => 'x86_64',
  version: () => 'browser',
  endianness: () => 'LE',
  EOL: '\n',
  devNull: '/dev/null',
  cpus: () => [{ model: 'browser', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }],
  availableParallelism: () => 1,
  totalmem: () => 4 * 1024 ** 3,
  freemem: () => 2 * 1024 ** 3,
  loadavg: () => [0, 0, 0],
  uptime: () => performance.now() / 1000,
  networkInterfaces: () => ({}),
  userInfo: () => ({ username: 'web', uid: 1000, gid: 1000, shell: null, homedir: '/home/web' }),
  constants: { signals: { SIGINT: 2, SIGTERM: 15, SIGKILL: 9 }, errno: {} },
};

// ——— url ———
function fileURLToPath(u: string | URL): string {
  const url = typeof u === 'string' ? new URL(u) : u;
  if (url.protocol !== 'file:') throw Object.assign(new TypeError('The URL must be of scheme file'), { code: 'ERR_INVALID_URL_SCHEME' });
  return decodeURIComponent(url.pathname);
}
function pathToFileURL(p: string): URL {
  return new URL('file://' + p.split('/').map(encodeURIComponent).join('/'));
}
export const url = { ...(urlPkg as any), URL, URLSearchParams, fileURLToPath, pathToFileURL, domainToASCII: (d: string) => d };

// ——— module ———
export const moduleShim = {
  createRequire: (from: string | URL) => {
    const req: any = (id: string) => {
      const reg = (globalThis as any).__airpNode;
      const name = id.replace(/^node:/, '');
      if (reg[name]) return reg[name];
      throw Object.assign(new Error(`Cannot find module '${id}' (browser mode: require from ${String(from)})`), { code: 'MODULE_NOT_FOUND' });
    };
    // Only used to build jiti alias tables; extensions are pre-bundled, so the id itself is enough.
    req.resolve = (id: string) => id;
    req.cache = {};
    return req;
  },
  builtinModules: [] as string[],
  isBuiltin: (s: string) => s.startsWith('node:'),
  register: () => {},
};

// ——— util ———
const ESC = /\u001b\[[0-9;]*[A-Za-z]/g;
export const util: any = {
  ...(utilPkg as any),
  TextDecoder,
  TextEncoder,
  stripVTControlCharacters: (s: string) => s.replace(ESC, ''),
  styleText: (_f: unknown, s: string) => s,
  isDeepStrictEqual: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
  parseArgs: unsupported('util.parseArgs'),
  getSystemErrorName: (n: number) => `E${n}`,
  aborted: (signal: AbortSignal) => new Promise<void>((r) => signal.addEventListener('abort', () => r(), { once: true })),
};
util.types = { ...(utilPkg as any).types, isNativeError: (e: unknown) => e instanceof Error, isPromise: (p: unknown) => p instanceof Promise };

// ——— tty ———
export const tty = { isatty: () => false, ReadStream: class {}, WriteStream: class {} };

// ——— assert ———
function fail(message?: string | Error): never {
  if (message instanceof Error) throw message;
  throw Object.assign(new Error(message ?? 'Assertion failed'), { name: 'AssertionError', code: 'ERR_ASSERTION' });
}
const assertFn: any = (v: unknown, m?: string) => { if (!v) fail(m); };
Object.assign(assertFn, {
  ok: assertFn,
  equal: (a: unknown, b: unknown, m?: string) => { if (a != b) fail(m ?? `${a} == ${b}`); },
  strictEqual: (a: unknown, b: unknown, m?: string) => { if (a !== b) fail(m ?? `${String(a)} === ${String(b)}`); },
  notStrictEqual: (a: unknown, b: unknown, m?: string) => { if (a === b) fail(m); },
  deepEqual: (a: unknown, b: unknown, m?: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(m); },
  deepStrictEqual: (a: unknown, b: unknown, m?: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(m); },
  fail,
  throws: (fn: () => void) => { try { fn(); } catch { return; } fail('Missing expected exception'); },
  AssertionError: Error,
});
assertFn.strict = assertFn;
export const assert = assertFn;

// ——— readline ———
export const readline = {
  createInterface: (opts: any) => {
    const ee: any = new EventEmitter();
    let buf = '';
    opts?.input?.on?.('data', (c: any) => {
      buf += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { ee.emit('line', buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    opts?.input?.on?.('end', () => { if (buf) ee.emit('line', buf); ee.emit('close'); });
    ee.close = () => ee.emit('close');
    ee.question = unsupported('readline.question');
    ee.setPrompt = () => {};
    ee.prompt = () => {};
    ee[Symbol.asyncIterator] = unsupported('readline async iteration');
    return ee;
  },
  emitKeypressEvents: () => {},
  clearLine: () => true,
  cursorTo: () => true,
  moveCursor: () => true,
};

// ——— async_hooks (synchronous-context approximation) ———
class AsyncLocalStorage<T> {
  #store: T | undefined;
  getStore() { return this.#store; }
  run<R>(store: T, fn: (...a: any[]) => R, ...args: any[]): R {
    const prev = this.#store;
    this.#store = store;
    try { return fn(...args); } finally { this.#store = prev; }
  }
  enterWith(store: T) { this.#store = store; }
  exit<R>(fn: (...a: any[]) => R, ...args: any[]): R { return this.run(undefined as any, fn, ...args); }
  disable() { this.#store = undefined; }
  static bind<F>(fn: F) { return fn; }
  static snapshot() { return (fn: (...a: any[]) => any, ...a: any[]) => fn(...a); }
}
class AsyncResource {
  constructor(public type: string) {}
  runInAsyncScope(fn: (...a: any[]) => any, thisArg?: unknown, ...args: any[]) { return fn.apply(thisArg, args); }
  bind<F>(fn: F) { return fn; }
  emitDestroy() { return this; }
  static bind<F>(fn: F) { return fn; }
}
export const asyncHooks = { AsyncLocalStorage, AsyncResource, createHook: () => ({ enable() { return this; }, disable() { return this; } }), executionAsyncId: () => 1, triggerAsyncId: () => 0 };

// ——— Node-style timers: handles with ref/unref/refresh, usable as numbers ———
class Timeout {
  constructor(public _id: any, private _re: () => any) {}
  ref() { return this; }
  unref() { return this; }
  hasRef() { return true; }
  refresh() { globalThis.clearTimeout(this._id); this._id = this._re(); return this; }
  close() { globalThis.clearTimeout(this._id); return this; }
  [Symbol.toPrimitive]() { return this._id; }
}
const unwrap = (t: any) => (t instanceof Timeout ? t._id : t);
export const nodeTimers = {
  setTimeout: (fn: any, ms?: number, ...a: any[]) => { const re = () => globalThis.setTimeout(fn, ms, ...a); return new Timeout(re(), re); },
  setInterval: (fn: any, ms?: number, ...a: any[]) => { const re = () => globalThis.setInterval(fn, ms, ...a); return new Timeout(re(), re); },
  clearTimeout: (t: any) => globalThis.clearTimeout(unwrap(t)),
  clearInterval: (t: any) => globalThis.clearInterval(unwrap(t)),
};
(globalThis as any).__airpTimers = nodeTimers;

// ——— perf_hooks / diagnostics_channel / timers ———
export const perfHooks = { performance, PerformanceObserver: class { observe() {} disconnect() {} }, monitorEventLoopDelay: () => ({ enable() {}, disable() {}, percentile: () => 0 }) };
const channel = () => ({ hasSubscribers: false, publish() {}, subscribe() {}, unsubscribe() {}, bindStore() {}, runStores: (_d: unknown, fn: any, t?: unknown, ...a: any[]) => fn.apply(t, a) });
export const diagnosticsChannel = {
  channel,
  hasSubscribers: () => false,
  subscribe: () => {},
  unsubscribe: () => {},
  tracingChannel: () => ({ hasSubscribers: false, start: channel(), end: channel(), asyncStart: channel(), asyncEnd: channel(), error: channel(), traceSync: (fn: any, _c: unknown, t?: unknown, ...a: any[]) => fn.apply(t, a), tracePromise: (fn: any, _c: unknown, t?: unknown, ...a: any[]) => fn.apply(t, a), subscribe() {}, unsubscribe() {} }),
};
export const timers = {
  ...nodeTimers,
  setImmediate: (globalThis as any).setImmediate, clearImmediate: (globalThis as any).clearImmediate,
};
export const timersPromises = {
  setTimeout: (ms = 0, value?: unknown, opts?: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(value), ms);
    opts?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(opts.signal!.reason); }, { once: true });
  }),
  setImmediate: (value?: unknown) => new Promise((r) => setTimeout(() => r(value), 0)),
  scheduler: { wait: (ms: number) => new Promise((r) => setTimeout(r, ms)), yield: () => new Promise((r) => setTimeout(r, 0)) },
};

// ——— worker_threads / v8 / vm ———
export const workerThreads = { isMainThread: true, parentPort: null, workerData: null, threadId: 0, Worker: class { constructor() { unsupported('worker_threads.Worker')(); } }, MessageChannel, MessagePort, BroadcastChannel };
export const v8 = { getHeapStatistics: () => ({ total_heap_size: 0, used_heap_size: 0, heap_size_limit: 0 }), serialize: unsupported('v8.serialize'), deserialize: unsupported('v8.deserialize'), setFlagsFromString: () => {} };
export const vm = { runInNewContext: unsupported('vm'), runInThisContext: unsupported('vm'), Script: class { constructor() { unsupported('vm.Script')(); } }, createContext: (o: unknown) => o, isContext: () => false };

// ——— zlib (sync only, via fflate) ———
const zlibSync = (f: (b: Uint8Array) => Uint8Array) => (b: Uint8Array) => Buffer.from(f(b instanceof Uint8Array ? b : Buffer.from(b as any)));
export const zlib = {
  gunzipSync: zlibSync(gunzipSync), gzipSync: zlibSync(gzipSync), inflateSync: zlibSync(inflateSync), deflateSync: zlibSync(deflateSync),
  inflateRawSync: zlibSync(inflateRawSync), deflateRawSync: zlibSync(deflateRawSync),
  createGunzip: unsupported('zlib streams'), createGzip: unsupported('zlib streams'), createInflate: unsupported('zlib streams'),
  createDeflate: unsupported('zlib streams'), createInflateRaw: unsupported('zlib streams'), createDeflateRaw: unsupported('zlib streams'),
  createBrotliDecompress: unsupported('zlib brotli'), createBrotliCompress: unsupported('zlib brotli'),
  brotliDecompressSync: unsupported('zlib brotli'), brotliCompressSync: unsupported('zlib brotli'),
  constants: { Z_SYNC_FLUSH: 2, Z_FINISH: 4, BROTLI_OPERATION_FLUSH: 1, BROTLI_OPERATION_FINISH: 2 },
};

// ——— network modules: importable, unusable ———
export const net = { createServer: unsupported('net.createServer'), connect: unsupported('net.connect'), createConnection: unsupported('net.createConnection'), Socket: class extends EventEmitter {}, Server: class extends EventEmitter {}, isIP: (s: string) => (/^\d+\.\d+\.\d+\.\d+$/.test(s) ? 4 : s.includes(':') ? 6 : 0), isIPv4: (s: string) => /^\d+\.\d+\.\d+\.\d+$/.test(s), isIPv6: (s: string) => s.includes(':') };
export const tls = { connect: unsupported('tls.connect'), createSecureContext: unsupported('tls'), TLSSocket: class extends EventEmitter {}, rootCertificates: [] };
export const dns = { lookup: unsupported('dns.lookup'), promises: { lookup: unsupported('dns.lookup') } };
export const http2 = { connect: unsupported('http2.connect'), constants: {} };
