import { useCallback, useEffect, useRef, useState } from 'react';
import { isBillingStop } from './model-errors.js';

/**
 * Player voice input with live transcription.
 *
 * The microphone is captured at the native rate through an AudioWorklet,
 * resampled to 24kHz here (a 24kHz AudioContext fed Chrome silence from a 48kHz
 * mic), and streamed as PCM16 to `/ws/stt`, which relays it to an OpenAI Realtime transcription
 * session. Partial text arrives while the player is still speaking. The text is
 * only a draft — the host decides when anything is sent.
 *
 * The microphone opens inside the player's click (never on mount) and is
 * released as soon as recording stops.
 */

export type VoiceInputState = 'idle' | 'connecting' | 'recording' | 'finishing';
export type VoiceInputError = 'mic_denied' | 'mic_unsupported' | 'unavailable' | 'failed';

/** Auto-stop so a forgotten recording cannot run (and bill) indefinitely. */
export const MAX_RECORDING_MS = 60_000;
export const SAMPLE_RATE = 24_000;
/** ~100ms of captured audio per frame (native rate, 48kHz typical). */
const CHUNK_SAMPLES = 4_800;
/** After Stop, wait this long at most for the last utterance to be finalised. */
const FINISH_TIMEOUT_MS = 4_000;
/**
 * Through the Worldlines AI service the relay transcribes the whole recording
 * after Stop (`{type:'transcribing'}`), which takes longer than a Realtime
 * flush: the wait is extended to this.
 */
const TRANSCRIBE_TIMEOUT_MS = 35_000;

const WORKLET_SOURCE = `
class AirpPcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('airp-pcm-tap', AirpPcmTap);
`;

/**
 * Streaming linear resampler from the capture rate to the relay rate. Browsers do
 * not reliably resample a 48kHz microphone into a 24kHz AudioContext (distorted or
 * silent input made the model hallucinate short words), so capture runs at the
 * native rate and we resample here, carrying the fractional position across chunks.
 */
export class LinearResampler {
  private position = 0;
  private last = 0;
  private readonly step: number;

  constructor(inputRate: number, outputRate: number) {
    this.step = inputRate / outputRate;
  }

  process(input: Float32Array): Float32Array {
    if (this.step === 1) return input;
    const out: number[] = [];
    // Sample i of this chunk sits at index i + 1 in [last, ...input].
    while (this.position <= input.length - 1 + 1e-9) {
      const index = this.position;
      const lower = Math.floor(index);
      const frac = index - lower;
      const a = lower === 0 ? this.last : input[lower - 1];
      const b = input[Math.min(lower, input.length - 1)];
      out.push(a + (b - a) * frac);
      this.position += this.step;
    }
    this.position -= input.length;
    this.last = input[input.length - 1] ?? this.last;
    return Float32Array.from(out);
  }
}

export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Ordered text of every utterance so far; a completed transcript replaces its deltas. */
export class TranscriptAssembler {
  private readonly order: string[] = [];
  private readonly text = new Map<string, string>();
  private readonly done = new Set<string>();

  delta(itemId: string, delta: string): void {
    if (!this.text.has(itemId)) {
      this.order.push(itemId);
      this.text.set(itemId, '');
    }
    if (!this.done.has(itemId)) this.text.set(itemId, (this.text.get(itemId) ?? '') + delta);
  }

  complete(itemId: string, transcript: string): void {
    if (!this.text.has(itemId)) this.order.push(itemId);
    this.text.set(itemId, transcript);
    this.done.add(itemId);
  }

  get value(): string {
    return this.order.map((id) => (this.text.get(id) ?? '').trim()).filter(Boolean).join(' ');
  }

  /** Every utterance that has started has also been finalised. */
  get settled(): boolean {
    return this.order.every((id) => this.done.has(id));
  }
}

/** Spoken text goes after whatever the player had already typed. */
export function joinDraft(base: string, spoken: string): string {
  if (!spoken) return base;
  const head = base.trimEnd();
  return head ? `${head} ${spoken}` : spoken;
}

function relayUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/stt`;
}

interface Session {
  socket: WebSocket;
  stream: MediaStream;
  context: AudioContext;
  node: AudioWorkletNode | null;
  assembler: TranscriptAssembler;
  finishing: boolean;
  stopTimer: number | null;
  finishTimer: number | null;
}

export function useVoiceInput({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [error, setError] = useState<VoiceInputError | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const releaseAudio = useCallback((session: Session) => {
    if (session.stopTimer !== null) window.clearTimeout(session.stopTimer);
    session.stopTimer = null;
    session.node?.port.close();
    session.node?.disconnect();
    session.node = null;
    for (const track of session.stream.getTracks()) track.stop();
    if (session.context.state !== 'closed') void session.context.close();
  }, []);

  const end = useCallback((failure?: VoiceInputError) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    busyRef.current = false;
    if (session) {
      if (session.finishTimer !== null) window.clearTimeout(session.finishTimer);
      releaseAudio(session);
      session.socket.onclose = null;
      if (session.socket.readyState <= WebSocket.OPEN) session.socket.close();
    }
    if (!mountedRef.current) return;
    setState('idle');
    if (failure) setError(failure);
  }, [releaseAudio]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      end();
    };
  }, [end]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.finishing) return;
    session.finishing = true;
    releaseAudio(session);
    if (session.socket.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify({ type: 'stop' }));
    if (session.assembler.settled && session.assembler.value === '' && session.socket.readyState !== WebSocket.OPEN) {
      end();
      return;
    }
    setState('finishing');
    session.finishTimer = window.setTimeout(() => end(), FINISH_TIMEOUT_MS);
  }, [end, releaseAudio]);

  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined' || typeof WebSocket === 'undefined') {
      busyRef.current = false;
      setError('mic_unsupported');
      return;
    }
    setState('connecting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      busyRef.current = false;
      if (mountedRef.current) {
        setState('idle');
        setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'mic_denied' : 'mic_unsupported');
      }
      return;
    }
    if (!mountedRef.current) {
      for (const track of stream.getTracks()) track.stop();
      busyRef.current = false;
      return;
    }

    // Native rate: forcing 24kHz here is where capture got distorted.
    const context = new AudioContext();
    const resampler = new LinearResampler(context.sampleRate, SAMPLE_RATE);
    const socket = new WebSocket(relayUrl());
    socket.binaryType = 'arraybuffer';
    const session: Session = {
      socket, stream, context, node: null, assembler: new TranscriptAssembler(),
      finishing: false, stopTimer: null, finishTimer: null,
    };
    sessionRef.current = session;

    let ready = false;
    const early: ArrayBuffer[] = [];
    socket.onmessage = (event) => {
      let message: { type?: string; itemId?: string; delta?: string; transcript?: string; code?: string };
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.type === 'ready') {
        ready = true;
        for (const frame of early.splice(0)) socket.send(frame);
      } else if (message.type === 'delta' && message.itemId) {
        session.assembler.delta(message.itemId, message.delta ?? '');
        if (mountedRef.current) onTranscriptRef.current(session.assembler.value);
      } else if (message.type === 'completed' && message.itemId) {
        session.assembler.complete(message.itemId, message.transcript ?? '');
        if (mountedRef.current) onTranscriptRef.current(session.assembler.value);
        if (session.finishing && session.assembler.settled) end();
      } else if (message.type === 'transcribing') {
        if (session.finishTimer !== null) window.clearTimeout(session.finishTimer);
        session.finishTimer = window.setTimeout(() => end(), TRANSCRIBE_TIMEOUT_MS);
      } else if (message.type === 'error') {
        // The account's plan is used up: the same notice as a writer turn (model-errors.ts).
        if (isBillingStop(message.code)) window.dispatchEvent(new CustomEvent('airp:notice', { detail: message.code }));
        end(message.code === 'stt_unavailable' ? 'unavailable' : 'failed');
      }
    };
    socket.onclose = () => {
      if (sessionRef.current === session) end(session.finishing ? undefined : 'failed');
    };

    try {
      const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try { await context.audioWorklet.addModule(moduleUrl); } finally { URL.revokeObjectURL(moduleUrl); }
      if (sessionRef.current !== session) return;
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'airp-pcm-tap');
      session.node = node;
      let pending: Float32Array[] = [];
      let pendingLength = 0;
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        pending.push(event.data);
        pendingLength += event.data.length;
        if (pendingLength < CHUNK_SAMPLES) return;
        const merged = new Float32Array(pendingLength);
        let offset = 0;
        for (const part of pending) { merged.set(part, offset); offset += part.length; }
        pending = [];
        pendingLength = 0;
        const frame = floatToPcm16(resampler.process(merged)).buffer as ArrayBuffer;
        if (ready && socket.readyState === WebSocket.OPEN) socket.send(frame);
        else early.push(frame);
      };
      // A silent sink keeps the worklet pulled by the graph without echoing the mic.
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(node).connect(sink).connect(context.destination);
      if (context.state === 'suspended') await context.resume();
    } catch {
      end('failed');
      return;
    }
    if (sessionRef.current !== session) return;
    setState('recording');
    session.stopTimer = window.setTimeout(() => stop(), MAX_RECORDING_MS);
  }, [end, stop]);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') void start();
  }, [state, start, stop]);

  return { state, error, toggle };
}
