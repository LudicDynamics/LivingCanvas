// Injected into the platform bundle (esbuild `inject`): every free `process`,
// `Buffer` and `setImmediate` resolves here, before any polyfill evaluates.
// worker.ts later upgrades this same object into a full process (createProcess).
import { Buffer } from 'buffer';

const g = globalThis as any;
const early = g.process ?? {
  env: {},
  argv: ['node', '/repo/apps/server/dist/index.js'],
  nextTick: (fn: (...a: any[]) => void, ...args: any[]) => queueMicrotask(() => fn(...args)),
  version: 'v22.12.0',
  versions: { node: '22.12.0' },
  platform: 'linux',
  browser: false,
  cwd: () => '/repo',
  emitWarning: () => {},
  stdout: { isTTY: false, write: () => true },
  stderr: { isTTY: false, write: () => true },
};
g.process = early;

// The `buffer` package predates Node's 'base64url' encoding (Node ≥ 15.7), which
// the server uses for sign-in state and PKCE. Teach it once, here, before any use.
if (!Buffer.isEncoding('base64url')) {
  const B = Buffer as any;
  const toUrl = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromUrl = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/');
  const isUrl = (e: unknown) => typeof e === 'string' && e.toLowerCase() === 'base64url';
  const { from, byteLength, isEncoding } = B;
  const { toString, write } = B.prototype;
  B.from = function (v: any, e?: any, n?: any) { return typeof v === 'string' && isUrl(e) ? from.call(this, fromUrl(v), 'base64') : from.call(this, v, e, n); };
  B.byteLength = function (v: any, e?: any) { return typeof v === 'string' && isUrl(e) ? byteLength.call(this, fromUrl(v), 'base64') : byteLength.call(this, v, e); };
  B.isEncoding = (e: unknown) => isUrl(e) || isEncoding(e);
  B.prototype.toString = function (e?: any, ...rest: any[]) { return isUrl(e) ? toUrl(toString.call(this, 'base64', ...rest)) : toString.call(this, e, ...rest); };
  B.prototype.write = function (s: string, ...rest: any[]) {
    const i = rest.findIndex(isUrl);
    if (i < 0) return write.call(this, s, ...rest);
    rest[i] = 'base64';
    return write.call(this, fromUrl(s), ...rest);
  };
}
// Newer than the oldest engines the runtime supports (Safari / iOS 16.4, README「浏览器要求」) and called on turn
// paths by the bundled server / pi-ai: Promise.withResolvers (Safari 17.4, Chrome 119), AbortSignal.any (Safari
// 17.4, Chrome 116). Small and exact; only filled in where missing.
if (typeof (Promise as any).withResolvers !== 'function') {
  (Promise as any).withResolvers = function withResolvers<T>() {
    let resolve!: (v: T | PromiseLike<T>) => void, reject!: (e?: unknown) => void;
    const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
  };
}
if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).any !== 'function') {
  (AbortSignal as any).any = function any(signals: Iterable<AbortSignal>): AbortSignal {
    const controller = new AbortController();
    const list = [...signals];
    const done = list.find((s) => s.aborted);
    if (done) { controller.abort(done.reason); return controller.signal; }
    const onAbort = (ev: Event) => {
      for (const s of list) s.removeEventListener('abort', onAbort);
      controller.abort((ev.target as AbortSignal).reason);
    };
    for (const s of list) s.addEventListener('abort', onAbort);
    return controller.signal;
  };
}
g.Buffer ??= Buffer;
g.global ??= g;
g.setImmediate ??= (fn: (...a: any[]) => void, ...args: any[]) => setTimeout(fn, 0, ...args);
g.clearImmediate ??= (t: any) => clearTimeout(t);

export const process = early;
export { Buffer };
export const setImmediate = g.setImmediate;
export const clearImmediate = g.clearImmediate;
