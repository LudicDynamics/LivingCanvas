// The `ws` package, server side only: a WebSocketServer whose sockets are
// message channels to the page instead of TCP connections.
import { EventEmitter } from 'events';

export class WebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  CONNECTING = 0;
  OPEN = 1;
  CLOSING = 2;
  CLOSED = 3;
  readyState = 1;
  protocol = '';
  bufferedAmount = 0;
  /** Set by the transport: deliver one frame / the close to the page. */
  _sendOut: (data: string) => void = () => {};
  _closeOut: (code?: number, reason?: string) => void = () => {};
  send(data: unknown, _opts?: unknown, cb?: (err?: Error) => void) {
    if (typeof _opts === 'function') cb = _opts as any;
    if (this.readyState !== 1) { cb?.(new Error('WebSocket is not open')); return; }
    this._sendOut(typeof data === 'string' ? data : new TextDecoder().decode(data as any));
    cb?.();
  }
  ping() { queueMicrotask(() => this.emit('pong')); }
  pong() {}
  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this._closeOut(code, reason);
    queueMicrotask(() => this.emit('close', code, reason));
  }
  terminate() { this.close(1006, 'terminated'); }
  /** Transport: a frame arrived from the page (binary = the voice-input PCM on /ws/stt). */
  _receive(data: string | ArrayBuffer | ArrayBufferView) {
    if (typeof data === 'string') { this.emit('message', data, false); return; }
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.emit('message', Buffer.from(bytes), true);
  }
  /** Transport: the page closed its end. */
  _remoteClose(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.emit('close', code, reason);
  }
}

export class WebSocketServer extends EventEmitter {
  clients = new Set<WebSocket>();
  options: any;
  constructor(options: any = {}) {
    super();
    this.options = options;
  }
  handleUpgrade(_req: unknown, socket: any, _head: unknown, cb: (ws: WebSocket) => void) {
    const ws: WebSocket = socket.__makeWebSocket();
    this.clients.add(ws);
    ws.once('close', () => this.clients.delete(ws));
    cb(ws);
  }
  shouldHandle() { return true; }
  close(cb?: () => void) { for (const c of this.clients) c.close(1001); cb?.(); }
  address() { return null; }
}

export const Server = WebSocketServer;
export default Object.assign(WebSocket, { WebSocket, WebSocketServer, Server });
