// node:http as an in-worker request dispatcher. `http.createServer(handler)` +
// `listen()` registers the server; the page's fetch('/api/…') arrives as a
// message and is replayed through the real Express app via fake
// IncomingMessage / ServerResponse objects. `upgrade` is emitted the same way
// for WebSocket connections (see ws.ts).
import { EventEmitter } from 'events';
import { Readable, Writable } from 'readable-stream';
import { Buffer } from 'buffer';

export const STATUS_CODES: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 206: 'Partial Content', 301: 'Moved Permanently',
  302: 'Found', 304: 'Not Modified', 307: 'Temporary Redirect', 400: 'Bad Request', 401: 'Unauthorized',
  403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 413: 'Payload Too Large',
  415: 'Unsupported Media Type', 416: 'Range Not Satisfiable', 422: 'Unprocessable Entity', 423: 'Locked',
  429: 'Too Many Requests', 500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout',
};
export const METHODS = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'];

export class FakeSocket extends EventEmitter {
  remoteAddress = '127.0.0.1';
  remotePort = 0;
  localAddress = '127.0.0.1';
  localPort = 0;
  encrypted = false;
  writable = true;
  readable = true;
  destroyed = false;
  setTimeout() { return this; }
  setNoDelay() { return this; }
  setKeepAlive() { return this; }
  write() { return true; }
  end() { this.destroy(); }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.writable = false; this.emit('close'); } return this; }
  address() { return { address: '127.0.0.1', family: 'IPv4', port: 0 }; }
}

export class IncomingMessage extends Readable {
  headers: Record<string, string> = {};
  rawHeaders: string[] = [];
  method = 'GET';
  url = '/';
  httpVersion = '1.1';
  httpVersionMajor = 1;
  httpVersionMinor = 1;
  complete = false;
  socket: any;
  connection: any;
  trailers = {};
  constructor(socket?: any) {
    super();
    this.socket = this.connection = socket ?? new FakeSocket();
  }
  _read() {}
  setTimeout() { return this; }
}

export class ServerResponse extends Writable {
  statusCode = 200;
  statusMessage = '';
  headersSent = false;
  finished = false;
  sendDate = false;
  req: any;
  socket: any;
  connection: any;
  chunkedEncoding = false;
  #headers = new Map<string, [string, any]>();
  #chunks: Uint8Array[] = [];
  onDone?: (r: { status: number; headers: Record<string, string>; body: Uint8Array }) => void;
  constructor(req: any) {
    super();
    this.req = req;
    this.socket = this.connection = req?.socket ?? new FakeSocket();
  }
  setHeader(name: string, value: any) { this.#headers.set(name.toLowerCase(), [name, value]); return this; }
  getHeader(name: string) { return this.#headers.get(name.toLowerCase())?.[1]; }
  getHeaders() { const o: Record<string, any> = Object.create(null); for (const [k, [, v]] of this.#headers) o[k] = v; return o; }
  getHeaderNames() { return [...this.#headers.keys()]; }
  hasHeader(name: string) { return this.#headers.has(name.toLowerCase()); }
  removeHeader(name: string) { this.#headers.delete(name.toLowerCase()); }
  appendHeader(name: string, value: any) {
    const cur = this.getHeader(name);
    this.setHeader(name, cur === undefined ? value : [].concat(cur, value));
    return this;
  }
  flushHeaders() { this.headersSent = true; }
  writeHead(status: number, msgOrHeaders?: any, maybeHeaders?: any) {
    this.statusCode = status;
    const headers = typeof msgOrHeaders === 'string' ? maybeHeaders : msgOrHeaders;
    if (typeof msgOrHeaders === 'string') this.statusMessage = msgOrHeaders;
    if (Array.isArray(headers)) for (let i = 0; i < headers.length; i += 2) this.setHeader(headers[i], headers[i + 1]);
    else if (headers) for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
    this.headersSent = true;
    return this;
  }
  writeContinue() {}
  setTimeout() { return this; }
  _write(chunk: any, enc: any, cb: () => void) {
    this.headersSent = true;
    this.#chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, enc) : new Uint8Array(chunk));
    cb();
  }
  _final(cb: () => void) {
    this.finished = true;
    this.headersSent = true;
    const total = this.#chunks.reduce((n, c) => n + c.length, 0);
    const body = new Uint8Array(total);
    let o = 0;
    for (const c of this.#chunks) { body.set(c, o); o += c.length; }
    const headers: Record<string, string> = {};
    for (const [k, [, v]] of this.#headers) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    this.onDone?.({ status: this.statusCode, headers, body });
    cb();
    queueMicrotask(() => this.emit('close'));
  }
}

export class Server extends EventEmitter {
  listening = false;
  constructor(handler?: (req: any, res: any) => void) {
    super();
    if (handler) this.on('request', handler);
  }
  listen(...args: any[]) {
    const cb = args.find((a) => typeof a === 'function');
    this.listening = true;
    (globalThis as any).__airpHttpServers ??= [];
    (globalThis as any).__airpHttpServers.push(this);
    queueMicrotask(() => { this.emit('listening'); cb?.(); });
    return this;
  }
  close(cb?: () => void) { this.listening = false; cb?.(); return this; }
  address() { return { address: '127.0.0.1', family: 'IPv4', port: 3001 }; }
  setTimeout() { return this; }
  ref() { return this; }
  unref() { return this; }
}

export function createServer(a?: any, b?: any) { return new Server(typeof a === 'function' ? a : b); }

/** Dispatch one request through a registered server. */
export function dispatch(server: Server, req: { method: string; url: string; headers: Record<string, string>; body?: Uint8Array | null }) {
  return new Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>((resolve) => {
    const im = new IncomingMessage();
    im.method = req.method.toUpperCase();
    im.url = req.url;
    const headers: Record<string, string> = { host: 'localhost' };
    for (const [k, v] of Object.entries(req.headers ?? {})) headers[k.toLowerCase()] = v;
    const body = req.body && req.body.length ? req.body : null;
    if (body) headers['content-length'] = String(body.length);
    im.headers = headers;
    im.rawHeaders = Object.entries(headers).flat();
    const res = new ServerResponse(im);
    res.onDone = resolve;
    server.emit('request', im, res);
    if (body) im.push(Buffer.from(body));
    im.push(null);
    im.complete = true;
  });
}

const unsupported = (what: string) => () => { throw new Error(`${what} is not available in browser mode`); };
export const request = unsupported('http.request');
export const get = unsupported('http.get');
export class Agent extends EventEmitter { destroy() {} }
export const globalAgent = new Agent();
export default { STATUS_CODES, METHODS, IncomingMessage, ServerResponse, Server, createServer, request, get, Agent, globalAgent };
