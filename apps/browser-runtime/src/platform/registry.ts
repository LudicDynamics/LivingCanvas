// The one table of node:* modules shared by every program in the Worker.
// Program bundles never contain their own fs / sqlite / child_process: their
// `import 'node:fs'` compiles to a lookup here (see build.mjs, `airp-node:`), so
// the server and each pi-rp CLI instance see the same VFS and the same pipes.
import * as bufferMod from 'buffer';
import * as eventsMod from 'events';
import * as streamMod from 'readable-stream';
import * as sdMod from 'string_decoder';
import * as qsMod from 'querystring-es3';
import { fs } from './fs';
import * as sqlite from './sqlite';
import * as crypto from './crypto';
import * as http from './http';
import * as ws from './ws';
import * as childProcess from './child-process';
import * as misc from './misc';
import pathMod from './path';

const EventEmitter: any = (eventsMod as any).default ?? eventsMod;
if (!EventEmitter.EventEmitter) EventEmitter.EventEmitter = EventEmitter;
EventEmitter.once ??= (em: any, name: string) => new Promise((res) => em.once(name, (...a: any[]) => res(a)));
EventEmitter.on ??= () => { throw new Error('events.on is not available in browser mode'); };
EventEmitter.setMaxListeners ??= () => {};
EventEmitter.getEventListeners ??= (em: any, n: string) => em.listeners?.(n) ?? [];
EventEmitter.addAbortListener ??= (signal: AbortSignal, fn: () => void) => {
  signal.addEventListener('abort', fn, { once: true });
  return { [Symbol.dispose]: () => signal.removeEventListener('abort', fn) };
};

const s: any = { ...streamMod };
const Stream: any = s.Stream ?? s.default;
for (const k of Object.keys(s)) if (!(k in Stream)) { try { Stream[k] = s[k]; } catch { /* getter-only */ } }
const streamPromises = {
  pipeline: (...a: any[]) => new Promise((res, rej) => s.pipeline(...a, (e: any) => (e ? rej(e) : res(undefined)))),
  finished: (st: any, o?: any) => new Promise((res, rej) => s.finished(st, o ?? {}, (e: any) => (e ? rej(e) : res(undefined)))),
};
if (!Stream.promises) Stream.promises = streamPromises;
const streamWeb = { ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream };

const httpMod: any = { ...http };
const reg: Record<string, any> = {
  fs,
  'fs/promises': fs.promises,
  buffer: { ...bufferMod, Blob, File: (globalThis as any).File, atob, btoa, constants: { MAX_LENGTH: 2 ** 31 - 1 }, kMaxLength: 2 ** 31 - 1 },
  events: EventEmitter,
  stream: Stream,
  'stream/promises': streamPromises,
  'stream/web': streamWeb,
  string_decoder: sdMod,
  querystring: (qsMod as any).default ?? qsMod,
  util: misc.util,
  'util/types': misc.util.types,
  url: misc.url,
  os: misc.os,
  module: misc.moduleShim,
  tty: misc.tty,
  assert: misc.assert,
  'assert/strict': misc.assert,
  readline: misc.readline,
  async_hooks: misc.asyncHooks,
  perf_hooks: misc.perfHooks,
  diagnostics_channel: misc.diagnosticsChannel,
  timers: misc.timers,
  'timers/promises': misc.timersPromises,
  worker_threads: misc.workerThreads,
  v8: misc.v8,
  vm: misc.vm,
  zlib: misc.zlib,
  net: misc.net,
  tls: misc.tls,
  dns: misc.dns,
  'dns/promises': misc.dns.promises,
  http2: misc.http2,
  http: httpMod,
  https: httpMod,
  crypto: { ...crypto },
  sqlite: { ...sqlite },
  child_process: { ...childProcess },
  ws: ws.default,
  path: pathMod,
  constants: { ...fs.constants, ...misc.os.constants.signals },
  'path/posix': pathMod,
};
for (const k of Object.keys(reg)) if (reg[k] && typeof reg[k] === 'object' && !('default' in reg[k])) {
  try { reg[k].default = reg[k]; } catch { /* frozen namespace */ }
}
(globalThis as any).__airpNode = reg;

/** A node:* module browser mode does not provide: importable, throws on use. */
(globalThis as any).__airpMissing = (name: string) => new Proxy({}, {
  get: (_t, k) => (k === 'default' || k === '__esModule' || typeof k === 'symbol' ? undefined : k in Object.prototype ? (Object.prototype as any)[k] : () => {
    throw Object.assign(new Error(`node:${name}.${String(k)} is not available in browser mode`), { code: 'ERR_BROWSER_MODE' });
  }),
});

/** `import.meta.resolve` in a bundle: only feeds jiti alias tables, so any stable file URL will do. */
(globalThis as any).__airpMetaResolve = (spec: string) => (spec.startsWith('file:') ? spec : `file:///repo/node_modules/${spec}`);

/**
 * Runtime `import(specifier)` from a program (variable specifiers esbuild cannot bundle).
 * `local` is the calling program run's own pre-bundled table (jiti.ts): extension
 * modules are per spawn, so one agent's import never returns another agent's instance.
 */
(globalThis as any).__airpImport = async (spec: unknown, local?: Map<string, unknown>) => {
  const s = String(spec);
  const name = s.replace(/^node:/, '');
  if (reg[name]) return { ...reg[name], default: reg[name].default ?? reg[name] };
  const pre = local?.get(s.replace(/^file:\/\//, ''));
  if (pre) return pre;
  throw Object.assign(new Error(`Cannot import "${s}" in browser mode (not pre-bundled)`), { code: 'ERR_MODULE_NOT_FOUND' });
};
export default reg;
