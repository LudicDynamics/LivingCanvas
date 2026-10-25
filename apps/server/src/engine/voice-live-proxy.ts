import WebSocket, { type RawData } from 'ws';
import type { BrainTap } from './voice-live-brain.js';
import { resolveVoiceLiveUrl, voiceLiveSocketUrl } from './voice-provider.js';

/**
 * voice-live reverse proxy.
 *
 * Browser ⇄ `/ws/voice-live` ⇄ voice-live's `WS /ws`. The browser only ever
 * talks to the canvas origin; it never learns where voice-live lives.
 *
 * This REVERSES integration.md §1's "服务器不碰音频" for our deployment — we
 * carry the audio bytes. the team's reasons, in order: one origin for the browser,
 * so the call works through the `/airp-infini-canvas/` subpath and the seat
 * gateway like every other route; and the voice-live host stays private, so it
 * can sit on Tailscale or another Mac without that address reaching a page.
 * The cost is real and recorded in the doc: our process is now in the audio
 * path, so a slow link or a busy server shows up as call latency, and
 * integration.md §7.4's missing concurrency ceiling now applies to us too.
 *
 * The one hard rule here: **this is a byte pipe, not a participant.** Binary
 * frames pass through untouched and in order — never parsed, never merged,
 * never re-framed, because a `segment` header and the PCM chunks that belong to
 * it are only correct as an ordered sequence. Text passes through verbatim too:
 * "helpfully" rewriting a frame would make our copy of the protocol a second
 * source of truth for it. The ONLY frame this module ever authors is the
 * `error` below, when there is no upstream to pipe to.
 *
 * One seam, owned elsewhere: when the call's character is answered by THIS
 * server (`voice-live-brain.ts`), upstream text frames are offered to that tap
 * first, and a frame it claims as a `brain` frame never reaches the browser.
 * The pipe itself still reads nothing.
 */

export const VOICE_LIVE_STREAM_PATH = '/ws/voice-live';

/**
 * Connect budget. Short on purpose: voice-live is normally on the same machine,
 * so a connection that has not opened by now is a backend that is not running,
 * and the player is better served by a visible failure than by a spinner.
 */
const UPSTREAM_OPEN_TIMEOUT_MS = 5_000;
/** Before the URL is known: cast lookup, and possibly a local voice-live still starting. */
const UPSTREAM_PREPARE_TIMEOUT_MS = 130_000;

/**
 * How much the browser may buffer upstream before the connection opens. One
 * frame is ~100ms of 16kHz PCM16 (~3.2 KB), so this is a few seconds of speech —
 * enough to cover a slow connect, bounded so a never-opening upstream cannot
 * grow the heap.
 */
const MAX_QUEUED_FRAMES = 64;

function toBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/** One frame waiting for the upstream socket, with the kind it must keep. */
interface Queued {
  data: Buffer;
  binary: boolean;
}

/**
 * Pipe one browser socket to one voice-live session.
 *
 * `WebSocketImpl` and `upstreamUrl` are test seams: the whole relay is
 * observable with two fake sockets and no voice-live running. `upstreamUrl`
 * may also be a promise — `index.ts` passes one that reads the character's
 * README to pick the voice (`voice-live-cast.ts`). Browser frames that arrive
 * while it resolves wait in the same bounded queue as a slow upstream connect.
 */
export function handleVoiceLiveStream(
  client: WebSocket,
  options: {
    WebSocketImpl?: typeof WebSocket;
    upstreamUrl?: string | Promise<string>;
    /** Handshake headers for the upstream (the gateway's credential). Never logged. */
    headers?: Record<string, string>;
    /** Captured world fence; false closes the pipe before any further relay. */
    isCurrent?: () => boolean;
    /** The character brain answered here: given a way to send upstream, returns the tap. */
    brain?: (sendUpstream: (text: string) => void) => BrainTap;
  } = {},
): void {
  const WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  const target = options.upstreamUrl ?? voiceLiveSocketUrl(resolveVoiceLiveUrl());
  const isCurrent = options.isCurrent ?? (() => true);

  let finished = false;
  /**
   * The visible-failure path. It borrows
   * voice-live's OWN `error{where,message}` shape rather than inventing a
   * proxy-specific frame, so the browser has exactly one error code path
   * whether the failure happened here or upstream. `where: 'proxy'` is what
   * tells the two apart in a log.
   */
  const failVisibly = (message: string): void => {
    if (!isCurrent() || client.readyState !== WebSocket.OPEN) return;
    try {
      client.send(JSON.stringify({ type: 'error', where: 'proxy', message }));
    } catch {
      /* the browser is already gone; the close below is all that is left */
    }
  };

  let upstream: WebSocket | null = null;
  let tap: BrainTap | null = null;
  const finish = (reason?: string): void => {
    if (finished) return;
    finished = true;
    clearTimeout(openTimer);
    tap?.close();
    if (reason) failVisibly(reason);
    try { upstream?.close(); } catch { /* already gone */ }
    try { client.close(); } catch { /* already gone */ }
  };

  // A promised target may first wait for this computer's voice-live to start (local-voice-live.ts,
  // up to its own start timeout), so the 5 s open budget only starts once the URL is known.
  let openTimer = setTimeout(
    () => finish('voice backend unavailable'),
    typeof target === 'string' ? UPSTREAM_OPEN_TIMEOUT_MS : UPSTREAM_PREPARE_TIMEOUT_MS,
  );

  // One queue for BOTH kinds: the client's `played` / `interrupted` receipts are
  // only meaningful in sequence with the audio around them, so splitting text
  // and binary into two queues would reorder them.
  const queued: Queued[] = [];
  let open = false;
  let dropped = 0;

  const connect = (url: string): void => {
    if (finished) return;
    if (!isCurrent()) {
      finish();
      return;
    }
    if (typeof target !== 'string') {
      clearTimeout(openTimer);
      openTimer = setTimeout(() => finish('voice backend unavailable'), UPSTREAM_OPEN_TIMEOUT_MS);
    }
    let socket: WebSocket;
    try {
      socket = options.headers ? new WebSocketImpl(url, { headers: options.headers }) : new WebSocketImpl(url);
    } catch (err) {
      // A malformed VOICE_LIVE_URL is an operator error, so it is worth a log —
      // but the log is the only place the address may appear.
      console.warn(`[AIRP VoiceLive] Upstream URL is unusable (${err instanceof Error ? err.name : 'Error'}).`);
      finish('voice backend unavailable');
      return;
    }
    upstream = socket;
    tap = options.brain?.((text) => {
      if (!isCurrent()) {
        finish();
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(text);
      } catch {
        finish();
      }
    }) ?? null;

    socket.on('open', () => {
      if (!isCurrent()) {
        finish();
        return;
      }
      open = true;
      clearTimeout(openTimer);
      for (const frame of queued.splice(0)) {
        try {
          socket.send(frame.data, { binary: frame.binary });
        } catch {
          finish();
          return;
        }
      }
      if (dropped > 0) {
        // Say it once. Dropped mic audio is a real gap in what she heard, and a
        // silent gap is the thing this repo refuses to ship.
        console.warn(`[AIRP VoiceLive] Dropped ${dropped} frame(s) queued before the upstream opened.`);
      }
    });

    // Upstream → browser. Verbatim, kind preserved. `isBinary` is the only thing
    // we read, and only so the frame arrives as the same kind it left as.
    socket.on('message', (data, isBinary) => {
      if (!isCurrent()) {
        finish();
        return;
      }
      const frame = toBuffer(data);
      if (!isBinary && tap?.take(frame)) return;
      if (client.readyState !== WebSocket.OPEN) return;
      try {
        client.send(frame, { binary: isBinary });
      } catch {
        finish();
      }
    });

    // Status only: never log what was said, and never the upstream address.
    socket.on('unexpected-response', (_req, res) => {
      console.warn(`[AIRP VoiceLive] Upstream refused the upgrade (${res.statusCode}).`);
      finish('voice backend unavailable');
    });
    socket.on('error', (err) => {
      console.warn(`[AIRP VoiceLive] Upstream connection failed (${err.name}).`);
      finish('voice backend unavailable');
    });
    socket.on('close', () => finish());
  };

  // Browser → upstream. Same discipline in this direction.
  client.on('message', (data, isBinary) => {
    if (!isCurrent()) {
      finish();
      return;
    }
    const frame = toBuffer(data);
    if (open && upstream) {
      if (upstream.readyState !== WebSocket.OPEN) return;
      try {
        upstream.send(frame, { binary: isBinary });
      } catch {
        finish();
      }
      return;
    }
    if (queued.length >= MAX_QUEUED_FRAMES) {
      // Drop the OLDEST: the newest audio is the part she still has a chance of
      // answering, and an unbounded queue would only delay the same loss.
      queued.shift();
      dropped += 1;
    }
    queued.push({ data: frame, binary: isBinary });
  });
  client.on('close', () => finish());
  client.on('error', () => finish());

  if (typeof target === 'string') {
    connect(target);
  } else {
    target.then(connect, () => finish('voice backend unavailable'));
  }
}
