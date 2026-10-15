import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { TLSSocket } from 'node:tls';
import type { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION, WS_CLOSE } from '@airp/shared';

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin === 'null' ||
      url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Exact HTTP(S) frontend origins configured by AIRP_WS_ALLOWED_ORIGINS. */
export function parseWsAllowedOrigins(value = process.env.AIRP_WS_ALLOWED_ORIGINS): ReadonlySet<string> {
  const origins = new Set<string>();
  if (!value?.trim()) return origins;
  for (const entry of value.split(',')) {
    const candidate = entry.trim();
    const origin = candidate ? normalizedOrigin(candidate) : null;
    if (!origin) throw new Error('AIRP_WS_ALLOWED_ORIGINS must contain only exact HTTP(S) origins.');
    origins.add(origin);
  }
  return origins;
}

/**
 * Browser Origin is a CSWSH boundary, not user authentication. Browser requests
 * must be same-origin with the actual incoming frontend/proxy host, or match an
 * explicitly configured frontend origin. Non-browser clients without Origin
 * remain trusted by the deployment's network boundary.
 */
export function isTrustedBrowserOrigin(
  req: Pick<IncomingMessage, 'headers' | 'socket'>,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  const header = req.headers.origin;
  if (header === undefined) return true;
  if (typeof header !== 'string') return false;
  const origin = normalizedOrigin(header);
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;

  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') return false;
  const forwardedProtocol = req.headers['x-forwarded-proto'];
  const protocol = typeof forwardedProtocol === 'string'
    ? forwardedProtocol.split(',')[0]?.trim().toLowerCase()
    : req.socket instanceof TLSSocket ? 'https' : 'http';
  if (protocol !== 'http' && protocol !== 'https') return false;
  const requestOrigin = normalizedOrigin(`${protocol}://${host}`);
  return requestOrigin !== null && requestOrigin === origin;
}

function rejectUpgrade(socket: Duplex): void {
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}

/** Install the shared noServer upgrade policy; `/ws` is admitted before replay or command dispatch. */
export function registerGatewayUpgrades(
  server: Server,
  wss: WebSocketServer,
  options: {
    sttPath: string;
    voiceLivePath: string;
    allowedOrigins: ReadonlySet<string>;
  },
): void {
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const isCanvas = url.pathname === '/ws';
    const isStt = url.pathname.startsWith(options.sttPath);
    const isVoiceLive = url.pathname === options.voiceLivePath;
    if (!isCanvas && !isStt && !isVoiceLive) return;

    if (!isTrustedBrowserOrigin(req, options.allowedOrigins)) {
      rejectUpgrade(socket);
      return;
    }
    if (isCanvas && url.searchParams.get('v') !== PROTOCOL_VERSION) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(WS_CLOSE.PROTOCOL_MISMATCH, 'protocol version mismatch');
      });
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}
