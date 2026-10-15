/**
 * audio.ts — AIRP Web Audio engine: sample-first, synth-fallback.
 *
 * Two chains, one surface:
 *  1. Sample chain — `fetch → decodeAudioData → AudioBufferSourceNode → GainNode
 *     → master`, fed by server-resolved URLs (`/api/audio` platform pool or
 *     `/api/asset` world files). One decode per URL (`decodeCache`), failures
 *     remembered (`failCached`) so a 404 is never re-fetched.
 *  2. Synth chain — the original runtime synthesizer, kept verbatim as the
 *     offline演出保底 (contract §5.2 / §9 anti-pattern 4): `templates/**` ships
 *     no `assets/`, so world-level samples legitimately 404 and the demo must
 *     still make sound.
 *
 * Three independent main tracks crossfade over `AMBIENT_FADE` (1.5s):
 * `ambient` (layer bed) / `bgm` (layer mood) / `theme` (world theme), plus
 * one-shot `playFoley` / `playStinger` voices that never touch a main-track
 * gain. A main track declared `null` is *declared silence* (the synth bed stops
 * too); a URL that fails to load is *degradation* (the synth bed takes over,
 * except `theme`, which has no synth voice).
 *
 * Every burst voice runs through an attack/decay envelope so nothing clicks.
 */

export type FoleyName =
  | 'paper-slide'
  | 'bag-pack'
  | 'dice-roll'
  | 'unlock'
  | 'pen-scratch'
  | 'gate-open'
  | 'crit-chime'
  | 'fumble-break'
  | 'page-turn'
  // The two presentations: a new
  // scene's title card, and an item obtained.
  | 'scene-sting'
  | 'item-get';

export type BGMood = 'calm' | 'tense' | 'crisis';

// `Emotion` is the ONE list of the six emotion differentials; it lives in
// @airp/shared so the server route and the web bundle cannot drift
//. Re-exported here because audio.ts was its long-time
// home and existing importers read it from `lib/audio.js`.
import type { Emotion } from '@airp/shared';
import { mediaReadiness } from './media-readiness.js';
import { announcePrefsChanged } from './prefs-events.js';
export type { Emotion };

type ToneKey = 'rain' | 'fireplace' | 'drip';

/** Seconds — crossfade used for ambient layers and BGM moods alike. */
const AMBIENT_FADE = 1.5;

/** Bed level per ambient layer (the drip layer is interval-scheduled; its
 *  voices envelope on top of this engine gain). */
const AMBIENT_TARGETS: Record<ToneKey, number> = {
  rain: 0.05,
  fireplace: 0.09,
  drip: 0.05,
};

/** Section gain per BGM mood — deliberately low, drones must never fight the
 *  narration. */
const BGM_TARGETS: Record<BGMood, number> = {
  calm: 0.03,
  tense: 0.045,
  crisis: 0.06,
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let voiceBus: GainNode | null = null;
let mutedState = false;

// One-shot requests are tied to the visibility epoch. A request that crosses
// a hidden transition is stale even if the tab becomes visible before decode
// completes; this prevents an old stinger/voice from landing off-beat.
let visibilityEpoch = 0;
let visibilityListenerAttached = false;
let mainTracksHidden = false;
function pageIsHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}
function ensureVisibilityGate(): void {
  if (
    visibilityListenerAttached ||
    typeof document === 'undefined' ||
    typeof document.addEventListener !== 'function'
  ) return;
  document.addEventListener('visibilitychange', () => {
    visibilityEpoch += 1;
    if (document.hidden) {
      stopVoice();
      pauseMainTracks();
    } else {
      resumeMainTracks();
    }
  });
  visibilityListenerAttached = true;
}
export type VolumeChannel = 'music' | 'voice';
function readVolume(channel: VolumeChannel): number {
  try {
    const raw = localStorage.getItem(`airp-volume-${channel}`);
    const value = raw === null ? 1 : Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  } catch {
    return 1;
  }
}
const channelVolumes = { music: readVolume('music'), voice: readVolume('voice') };
export function getChannelVolume(channel: VolumeChannel): number {
  return channelVolumes[channel];
}

/** Post-envelope channel gain: volume changes never restart a clip or reset its fade. */
export function setChannelVolume(channel: VolumeChannel, value: number): void {
  if (!Number.isFinite(value)) return;
  const next = Math.min(1, Math.max(0, value));
  channelVolumes[channel] = next;
  try {
    localStorage.setItem(`airp-volume-${channel}`, String(next));
  } catch {
    /* private mode or browserless runtime */
  }
  announcePrefsChanged();
  const bus = channel === 'music' ? musicBus : voiceBus;
  if (ctx && bus) {
    const t = ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(next, t + 0.03);
  }
}

const noiseCache = new Map<'white' | 'brown', AudioBuffer>();

/** Lazily create the shared context + master bus. Idempotent, safe to call
 *  from anywhere; returns null when Web Audio is unavailable. */
export function initAudio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0; // silent until the first unlock()/setMuted() reasserts
    master.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = channelVolumes.music;
    musicBus.connect(master);
    voiceBus = ctx.createGain();
    voiceBus.gain.value = channelVolumes.voice;
    voiceBus.connect(master);
  } catch (err) {
    console.warn('Web Audio unavailable:', err);
    ctx = null;
  }
  return ctx;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 2s noise buffer (cached): white = flat static, brown = leaky-integrator
 *  rumble. Short voices just play the head of the same buffer. */
function makeNoise(kind: 'white' | 'brown'): AudioBuffer {
  const c = ctx!;
  const cached = noiseCache.get(kind);
  if (cached) return cached;
  const len = Math.floor(c.sampleRate * 2);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  } else {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02; // one-pole leaky integrator ≈ brown spectrum
      data[i] = last * 3.5; // compensate the integrator's attenuation
    }
  }
  noiseCache.set(kind, buf);
  return buf;
}

function noiseSource(kind: 'white' | 'brown'): AudioBufferSourceNode {
  const src = ctx!.createBufferSource();
  src.buffer = makeNoise(kind);
  return src;
}

interface BurstOpts {
  /** total envelope length in seconds */
  dur: number;
  kind?: 'white' | 'brown';
  filter?: { type: BiquadFilterType; freqA: number; freqB?: number; q?: number };
  peak: number;
  attack?: number;
}

/** One-shot enveloped noise burst — the building block of every foley voice.
 *  Attack ramps 0→peak linearly (no click), decay falls exponentially to
 *  −60dB. Frequency is swept when freqB is given. */
function noiseBurst(dest: AudioNode, opts: BurstOpts, at?: number): void {
  const c = ctx!;
  const t = at ?? c.currentTime;
  const attack = opts.attack ?? 0.005;
  const dur = Math.max(opts.dur, attack + 0.01);
  const src = noiseSource(opts.kind ?? 'white');
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(opts.peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (opts.filter) {
    const f = c.createBiquadFilter();
    f.type = opts.filter.type;
    f.Q.value = opts.filter.q ?? 1;
    f.frequency.setValueAtTime(opts.filter.freqA, t);
    if (opts.filter.freqB !== undefined) {
      f.frequency.linearRampToValueAtTime(opts.filter.freqB, t + dur);
    }
    src.connect(f);
    f.connect(g);
  } else {
    src.connect(g);
  }
  g.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** Pitched thump/pop: sine with a downward glide + enveloped decay. Used for
 *  bag thuds, gate bass, drip plinks and fumble tones. */
function toneThump(
  dest: AudioNode,
  opts: { from: number; to: number; dur: number; peak: number; attack?: number; decay?: number },
  at?: number
): void {
  const c = ctx!;
  const t = at ?? c.currentTime;
  const attack = opts.attack ?? 0.004;
  const decay = opts.decay ?? opts.dur + 0.1;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(opts.from, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + opts.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(opts.peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + decay + 0.05);
}

/** Microscopic square click — mechanical latches (lock, pen), no ringing. */
function squareClick(dest: AudioNode, time: number, freq: number, dur: number, peak: number): void {
  const c = ctx!;
  const o = c.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(freq, time);
  const g = c.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + 0.0008);
  g.gain.linearRampToValueAtTime(0, time + dur);
  o.connect(g);
  g.connect(dest);
  o.start(time);
  o.stop(time + dur + 0.02);
}

/* ============================================================
 * Ambient layers — each engine: a looping bed + an interval
 * scheduler for the random detail voices (drops/crackles).
 * ============================================================ */

interface AmbientEngine {
  key: ToneKey;
  gain: GainNode;
  active: boolean;
  /** Re-arm the layer's random detail scheduler (self-rescheduling). */
  spawn: () => void;
}

const ambientEngines = new Map<ToneKey, AmbientEngine>();
let activeTone: ToneKey | null = null;

function buildAmbientEngines(): void {
  if (ambientEngines.size > 0 || !ctx) return;
  const c = ctx;

  // ---- rain: 2s white loop → 900Hz lowpass (steady hiss bed) ----
  const rainSrc = noiseSource('white');
  rainSrc.loop = true;
  const rainLp = c.createBiquadFilter();
  rainLp.type = 'lowpass';
  rainLp.frequency.value = 900;
  const rainG = c.createGain();
  rainG.gain.value = 0;
  rainSrc.connect(rainLp);
  rainLp.connect(rainG);
  rainG.connect(master!);
  rainSrc.start();
  const rain: AmbientEngine = {
    key: 'rain',
    gain: rainG,
    active: false,
    spawn: function loop() {
      window.setTimeout(() => {
        loop();
        if (!rain.active) return;
        // droplet: 3–6ms white ticklet through a ~4k bandpass, random level
        noiseBurst(rainG, {
          dur: 0.003 + Math.random() * 0.003,
          filter: { type: 'bandpass', freqA: 3800 + Math.random() * 600, q: 2.5 },
          peak: 0.01 + Math.random() * 0.02,
          attack: 0.001,
        });
      }, 40 + Math.random() * 50);
    },
  };
  ambientEngines.set('rain', rain);

  // ---- fireplace: brown loop → 350Hz lowpass (warm rumble bed) ----
  const fireSrc = noiseSource('brown');
  fireSrc.loop = true;
  const fireLp = c.createBiquadFilter();
  fireLp.type = 'lowpass';
  fireLp.frequency.value = 350;
  const fireG = c.createGain();
  fireG.gain.value = 0;
  fireSrc.connect(fireLp);
  fireLp.connect(fireG);
  fireG.connect(master!);
  fireSrc.start();
  const fire: AmbientEngine = {
    key: 'fireplace',
    gain: fireG,
    active: false,
    spawn: function loop() {
      window.setTimeout(() => {
        loop();
        if (!fire.active) return;
        // crackle: 1–4ms white spark through a ~1.5k bandpass
        noiseBurst(fireG, {
          dur: 0.001 + Math.random() * 0.003,
          filter: { type: 'bandpass', freqA: 1500, q: 3 },
          peak: 0.05 + Math.random() * 0.04,
          attack: 0.001,
        });
      }, 1000 + Math.random() * 1000);
    },
  };
  ambientEngines.set('fireplace', fire);

  // ---- cellar drip: no loop, a plink per 0.4–1.2s ----
  const dripG = c.createGain();
  dripG.gain.value = 0;
  dripG.connect(master!);
  const drip: AmbientEngine = {
    key: 'drip',
    gain: dripG,
    active: false,
    spawn: function loop() {
      window.setTimeout(() => {
        loop();
        if (!drip.active) return;
        // water drop: 900→200Hz sine slide over 60ms + fast decay = "plink"
        toneThump(dripG, { from: 900, to: 200, dur: 0.06, peak: 0.05, attack: 0.002, decay: 0.18 });
      }, 400 + Math.random() * 800);
    },
  };
  ambientEngines.set('drip', drip);
}

function ensureAmbientEngines(): void {
  if (!ctx || ambientEngines.size > 0) return;
  buildAmbientEngines();
  for (const eng of ambientEngines.values()) eng.spawn(); // start detail schedulers once
}

/** Re-assert all ambient gain ramps from the current moment (used on unlock
 *  because ramps scheduled while the context was suspended froze in time). */
function rampAmbient(): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  for (const [key, eng] of ambientEngines) {
    eng.active = key === activeTone;
    const target = eng.active ? AMBIENT_TARGETS[key] : 0;
    eng.gain.gain.cancelScheduledValues(t);
    eng.gain.gain.setValueAtTime(eng.gain.gain.value, t);
    eng.gain.gain.linearRampToValueAtTime(target, t + AMBIENT_FADE);
  }
}

/* ============================================================
 * BGM drones — three low-intensity moods, crossfaded like the
 * ambience.
 * ============================================================ */

interface BgmEngine {
  mood: BGMood;
  gain: GainNode;
  active: boolean;
  spawn?: () => void; // crisis beat scheduler (interval-driven voices)
}

const bgmEngines = new Map<BGMood, BgmEngine>();
let activeMood: BGMood | null = null;

function buildBgmEngines(): void {
  if (bgmEngines.size > 0 || !ctx) return;
  const c = ctx;

  // ---- calm: A1 + E2 sines over a breath-thin brown pad ----
  const calmG = c.createGain();
  calmG.gain.value = 0;
  const calmBus = c.createGain();
  calmBus.gain.value = 0.5;
  const a1 = c.createOscillator();
  a1.type = 'sine';
  a1.frequency.value = 55; // A1 root
  const e2 = c.createOscillator();
  e2.type = 'sine';
  e2.frequency.value = 82.5; // E2 fifth
  const calmPad = noiseSource('brown');
  calmPad.loop = true;
  const calmPadLp = c.createBiquadFilter();
  calmPadLp.type = 'lowpass';
  calmPadLp.frequency.value = 120;
  const calmPadG = c.createGain();
  calmPadG.gain.value = 0.008; // air under the sines, not a bed of its own
  a1.connect(calmBus);
  e2.connect(calmBus);
  calmPad.connect(calmPadLp);
  calmPadLp.connect(calmPadG);
  calmBus.connect(calmG);
  calmPadG.connect(calmG);
  calmG.connect(musicBus!);
  a1.start();
  e2.start();
  calmPad.start();
  bgmEngines.set('calm', { mood: 'calm', gain: calmG, active: false });

  // ---- tense: 55 + 58.3Hz near-semitone pair, slow 0.2Hz amplitude shimmer
  //      (the beating pair is the unease; the LFO trembles it) ----
  const tenseG = c.createGain();
  tenseG.gain.value = 0;
  const trem = c.createGain();
  trem.gain.value = 0.5;
  const t1 = c.createOscillator();
  t1.type = 'sine';
  t1.frequency.value = 55;
  const t2 = c.createOscillator();
  t2.type = 'sine';
  t2.frequency.value = 58.3;
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.2;
  const lfoG = c.createGain();
  lfoG.gain.value = 0.05; // ±0.05 around the 0.5 trem base
  t1.connect(trem);
  t2.connect(trem);
  lfo.connect(lfoG);
  lfoG.connect(trem.gain);
  trem.connect(tenseG);
  tenseG.connect(musicBus!);
  t1.start();
  t2.start();
  lfo.start();
  bgmEngines.set('tense', { mood: 'tense', gain: tenseG, active: false });

  // ---- crisis: low pulse every 0.5s + rising noise sweep, interval-driven ----
  const crisisG = c.createGain();
  crisisG.gain.value = 0;
  crisisG.connect(musicBus!);
  const crisisBeat = (): void => {
    // heartbeat thump
    toneThump(crisisG, { from: 110, to: 55, dur: 0.08, peak: 0.4, attack: 0.004, decay: 0.2 });
    // quick bandpass sweep scraping upward under the pulse
    noiseBurst(crisisG, {
      dur: 0.3,
      filter: { type: 'bandpass', freqA: 200, freqB: 800, q: 1 },
      peak: 0.1,
      attack: 0.01,
    });
  };
  const crisis: BgmEngine = {
    mood: 'crisis',
    gain: crisisG,
    active: false,
    spawn: function loop() {
      window.setTimeout(() => {
        loop();
        if (!crisis.active) return;
        crisisBeat();
      }, 500);
    },
  };
  bgmEngines.set('crisis', crisis);
}

function ensureBgmEngines(): void {
  if (!ctx || bgmEngines.size > 0) return;
  buildBgmEngines();
  bgmEngines.get('crisis')?.spawn?.(); // crisis scheduler runs once, gates on active
}

function rampBgm(): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  for (const [mood, eng] of bgmEngines) {
    eng.active = mood === activeMood;
    const target = eng.active ? BGM_TARGETS[mood] : 0;
    eng.gain.gain.cancelScheduledValues(t);
    eng.gain.gain.setValueAtTime(eng.gain.gain.value, t);
    eng.gain.gain.linearRampToValueAtTime(target, t + AMBIENT_FADE);
  }
}

/* ============================================================
 * Sample layer — real files behind the same surface as the synth
 * engines. Each track: one AudioBufferSourceNode (loop?) → its own
 * GainNode (crossfade ramp) → master. Sources are one-shot nodes
 * (same pattern as noiseSource(), :104): every play builds a fresh
 * source from the cached AudioBuffer.
 * ============================================================ */

type TrackId = 'ambient' | 'bgm' | 'theme';

interface Clip {
  url: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
  loop: boolean;
}

interface SampleTrack {
  ref: string | null; // declared ref verbatim (debug truth)
  clip: Clip | null; // what is sounding now
  token: number; // async-race guard
}

const tracks: Record<TrackId, SampleTrack> = {
  ambient: { ref: null, clip: null, token: 0 },
  bgm: { ref: null, clip: null, token: 0 },
  theme: { ref: null, clip: null, token: 0 },
};

const decodeCache = new Map<string, Promise<AudioBuffer>>();
const failCached = new Set<string>();

const SAMPLE_LEVELS: Record<TrackId, number> = { ambient: 0.5, bgm: 0.35, theme: 0.22 };
const FOLEY_SAMPLE_LEVEL = 0.14;
const STINGER_SAMPLE_LEVEL = 0.8;
/** Loudest tier: TTS narration outranks every existing bed/stinger
 *  (0.22 < 0.35 < 0.5 < 0.7 < 0.8 < 0.85). */
const VOICE_SAMPLE_LEVEL = 0.85;

const isUrl = (ref: string): boolean => ref.startsWith('/') || ref.startsWith('http');

/* --- URL → synth-hint helpers (used only on the sample-failure path).
 * toneFromHint is the body extracted from the former inline mapping that lived
 * in setAmbient; the inline copy is gone (no duplication).
 * ToneKey already exists above — not redeclared. --- */

/** Decode the file-name stem from a platform URL.
 *  `/api/audio?path=ambient%2Ffireplace.mp3` → 'fireplace'. */
function synthHintFromUrl(url: string): string {
  const file = url.split('/').pop() ?? '';
  const q = file.includes('?') ? (file.split('?')[1] ?? '') : file;
  const raw = q.includes('path=') ? decodeURIComponent(q.split('path=')[1] ?? '') : file;
  return (raw.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
}

/** Bare-hint → ambient bed; unknown hints degrade to the default rain bed. */
function toneFromHint(hint: string): ToneKey {
  const t = hint.trim().toLowerCase();
  if (t.includes('fire') || t.includes('hearth') || t === 'warm') return 'fireplace';
  if (t.includes('drip') || t.includes('cellar') || t.includes('cave')) return 'drip';
  return 'rain';
}

/** Bare-hint/stem → BGM mood; `calm` is the safe floor. */
function moodFromHint(hint: string): BGMood {
  const t = hint.trim().toLowerCase();
  if (t.includes('crisis')) return 'crisis';
  if (t.includes('tense')) return 'tense';
  return 'calm';
}

/* Synth halves of the per-track decision table: these drive the EXISTING
 * engines above. `null` silences the bed. */
function setSynthAmbient(tone: ToneKey | null): void {
  ensureAmbientEngines();
  activeTone = tone;
  rampAmbient();
}

function setSynthBgm(mood: BGMood | null): void {
  ensureBgmEngines();
  activeMood = mood;
  rampBgm();
}

/** Fetch → arrayBuffer → decode, cached per URL. Failure is recorded in
 *  failCached (never retried) and resolves to null — callers fall back to
 *  the synth engines. Never throws. */
function loadSample(url: string): Promise<AudioBuffer | null> {
  if (failCached.has(url)) return Promise.resolve(null);
  const cached = decodeCache.get(url);
  if (cached) return cached;

  const c = ctx;
  if (!c) return Promise.resolve(null); // no ctx → return FIRST, never cache a
  // promise: a stretched decodeCache entry would leak into
  // audioDebugState().loaded, breaking "loaded === []" without ctx.

  const p: Promise<AudioBuffer | null> = (async (): Promise<AudioBuffer | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      return await c.decodeAudioData(ab);
    } catch (err) {
      failCached.add(url);
      decodeCache.delete(url); // failCached owns the negative result
      console.warn('Audio: sample load failed', url, err);
      return null;
    }
  })();
  decodeCache.set(url, p as Promise<AudioBuffer>);
  return p;
}

/** Start a fresh one-shot source for `buffer`, fading its own gain up.
 *  TRACK-AGNOSTIC: takes a destination node, not a TrackId, so the three
 *  sample loops AND the foley/stinger one-shots share one player. Callers own
 *  the returned nodes: main tracks register them in tracks[id].clip; one-shots
 *  let onended clean themselves up. */
function playClip(
  dest: AudioNode,
  buffer: AudioBuffer,
  loop: boolean,
  level: number,
  attack = AMBIENT_FADE
): { src: AudioBufferSourceNode; gain: GainNode } | null {
  const c = ctx;
  if (!c) return null;

  const src = c.createBufferSource(); // one-shot node: never reuse
  src.buffer = buffer;
  src.loop = loop;
  const gain = c.createGain();
  gain.gain.value = 0; // fade in from silence (no click)
  src.connect(gain);
  gain.connect(dest);

  const t = c.currentTime;
  src.start(t); // start() is once-only per source
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(level, t + attack);

  if (!loop) {
    src.onended = (): void => {
      src.disconnect();
      gain.disconnect();
    };
  }
  return { src, gain };
}

/** Fade out, then stop + disconnect a specific main-track clip. */
function stopClip(track: TrackId, clip: Clip, fade: number): void {
  const c = ctx;
  if (!c) return;
  const t = c.currentTime;
  clip.gain.gain.cancelScheduledValues(t);
  clip.gain.gain.setValueAtTime(clip.gain.gain.value, t);
  clip.gain.gain.linearRampToValueAtTime(0, t + fade);
  window.setTimeout(() => {
    try {
      clip.src.stop();
    } catch {
      /* already stopped */
    }
    clip.src.disconnect();
    clip.gain.disconnect();
  }, fade * 1000 + 40);
  if (tracks[track].clip === clip) tracks[track].clip = null;
}

/** Play a main-track sample loop and register it in the track table. */
function playTrackLoop(track: TrackId, url: string, buffer: AudioBuffer, token: number): void {
  if (!master) return;
  const nodes = playClip(track === 'ambient' ? master : musicBus!, buffer, true, SAMPLE_LEVELS[track]);
  if (!nodes) return;
  // A newer set() landed while we were decoding → discard this clip.
  if (token !== tracks[track].token) {
    nodes.gain.gain.cancelScheduledValues(ctx!.currentTime);
    nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, ctx!.currentTime);
    nodes.gain.gain.linearRampToValueAtTime(0, ctx!.currentTime + 0.05);
    try {
      nodes.src.stop(ctx!.currentTime + 0.06);
    } catch {
      /* already stopped */
    }
    return;
  }
  const prev = tracks[track].clip;
  tracks[track].clip = { url, src: nodes.src, gain: nodes.gain, loop: true };
  if (prev) stopClip(track, prev, AMBIENT_FADE);
}

/** Declare a track's sample ref, then apply it. Records the ref even when
 *  there is no AudioContext (debug/test contract). */
function setTrackSample(track: TrackId, ref: string | null): void {
  const tr = tracks[track];
  tr.ref = ref;
  tr.token += 1;
  const c = initAudio();
  if (pageIsHidden()) return;
  if (!c || !master) return;
  if (!ref) {
    // Declared silence: stop the clip AND the synth bed — do not fall back.
    if (tr.clip) stopClip(track, tr.clip, AMBIENT_FADE);
    if (track === 'ambient') setSynthAmbient(null);
    else if (track === 'bgm') setSynthBgm(null);
    return;
  }
  if (!isUrl(ref)) {
    // Bare name = compat hint → synth only.
    if (tr.clip) stopClip(track, tr.clip, AMBIENT_FADE);
    if (track === 'ambient') setSynthAmbient(toneFromHint(ref));
    else if (track === 'bgm') setSynthBgm(moodFromHint(ref));
    else console.warn('Audio: theme expects a URL, got bare name', ref);
    return;
  }
  const token = tr.token;
  void mediaReadiness.request(track, ref, token);
  void loadSample(ref).then((buf) => {
    if (token !== tr.token || pageIsHidden()) return;
    if (buf) {
      mediaReadiness.markReady(track, ref, token);
      if (track === 'ambient') setSynthAmbient(null); // sample wins, silence the synth
      else if (track === 'bgm') setSynthBgm(null);
      playTrackLoop(track, ref, buf, token);
    } else {
      mediaReadiness.markFailed(track, ref, token, 'fetch');
      // Load FAILED → synth fallback. theme has no synth → stays silent.
      const stem = synthHintFromUrl(ref);
      if (track === 'ambient') setSynthAmbient(toneFromHint(stem));
      else if (track === 'bgm') setSynthBgm(moodFromHint(stem));
    }
  });
}
function pauseMainTracks(): void {
  if (mainTracksHidden) return;
  mainTracksHidden = true;
  for (const id of ['ambient', 'bgm', 'theme'] as TrackId[]) {
    const track = tracks[id];
    track.token += 1;
    if (track.clip) stopClip(id, track.clip, 0.05);
  }
  setSynthAmbient(null);
  setSynthBgm(null);
}

function resumeMainTracks(): void {
  if (!mainTracksHidden || pageIsHidden()) return;
  mainTracksHidden = false;
  for (const id of ['ambient', 'bgm', 'theme'] as TrackId[]) {
    setTrackSample(id, tracks[id].ref);
  }
}

/** Internal, show-local reversible ambient cut. It never changes the declared
 * ref and releases only while the same track token still owns the cut. */
export function beginTransientAmbientCut(
  ref: string | null,
  epoch: number
): { release: () => void } {
  const track = tracks.ambient;
  if (track.ref !== ref || pageIsHidden() || epoch !== visibilityEpoch) return { release: () => {} };
  const ownerToken = ++track.token;
  if (track.clip) stopClip('ambient', track.clip, 0.05);
  setSynthAmbient(null);
  let released = false;
  return {
    release: () => {
      if (released || pageIsHidden()) return;
      released = true;
      if (track.ref !== ref || track.token !== ownerToken || epoch !== visibilityEpoch) return;
      setTrackSample('ambient', ref);
    },
  };
}

/** Re-assert every clip ramp from now (mirrors rampAmbient). */
function rampClips(): void {
  const c = ctx;
  if (!c) return;
  const t = c.currentTime;
  const ids: TrackId[] = ['ambient', 'bgm', 'theme'];
  for (const id of ids) {
    const clip = tracks[id].clip;
    if (!clip) continue;
    clip.gain.gain.cancelScheduledValues(t);
    clip.gain.gain.setValueAtTime(clip.gain.gain.value, t);
    clip.gain.gain.linearRampToValueAtTime(SAMPLE_LEVELS[id], t + AMBIENT_FADE);
  }
}

/* ============================================================
 * Main-track surface — thin shells over setTrackSample.
 * ============================================================ */

/** Set the layer ambience: a server-resolved URL plays a real sample,
 *  a bare name falls back to the synth bed, `null` declares silence. */
export function setAmbient(ref: string | null): void {
  ensureVisibilityGate();
  setTrackSample('ambient', ref);
}

/** Set the layer BGM mood: same three-state contract as setAmbient. */
export function setBGM(ref: string | null): void {
  ensureVisibilityGate();
  setTrackSample('bgm', ref);
}

/** Set the world theme: an independent, light main track. `null` stops it;
 *  a load failure stays silent (no synth voice to fall back to). */
export function setTheme(ref: string | null): void {
  ensureVisibilityGate();
  setTrackSample('theme', ref);
}

/* ============================================================
 * Foley — nine one-shots, all < 1.5s, all with envelopes.
 * ============================================================ */

/** Synthesized interaction sound (the fallback chain). `intensity` (0–1)
 *  scales the paper-slide level; other voices ignore it. */
function synthFoley(name: FoleyName, intensity: number): void {
  if (!initAudio() || !master) return;
  const c = ctx!;
  const dest = c.createGain();
  dest.gain.value = .2;
  dest.connect(master);
  window.setTimeout(() => dest.disconnect(), 2000);
  const k = clamp01(intensity);
  const t = c.currentTime;

  switch (name) {
    case 'paper-slide': {
      // card dragged across paper: bandpass hiss whose pitch wanders 400–800Hz
      noiseBurst(dest, {
        dur: 0.08 + Math.random() * 0.07,
        filter: { type: 'bandpass', freqA: 400 + Math.random() * 300, freqB: 500 + Math.random() * 300, q: 0.8 },
        peak: 0.04 + 0.1 * k,
        attack: 0.008,
      });
      break;
    }
    case 'bag-pack': {
      // backpack lid thud: 130→55Hz downward sine + a 40ms noise tail
      toneThump(dest, { from: 130, to: 55, dur: 0.06, peak: 0.16, attack: 0.003, decay: 0.12 });
      noiseBurst(dest, { dur: 0.04, filter: { type: 'lowpass', freqA: 300 }, peak: 0.05, attack: 0.002 });
      break;
    }
    case 'dice-roll': {
      // die skittering across felt: 6–10 high ticks, then a settle thud
      const ticks = 6 + Math.floor(Math.random() * 5);
      let at = t;
      for (let i = 0; i < ticks; i++) {
        noiseBurst(
          dest,
          {
            dur: 0.02 + Math.random() * 0.03,
            filter: { type: 'bandpass', freqA: 2500 + Math.random() * 2500, q: 3 },
            peak: 0.06,
            attack: 0.001,
          },
          at
        );
        at += 0.06 + Math.random() * 0.08;
      }
      toneThump(dest, { from: 95, to: 60, dur: 0.06, peak: 0.14, attack: 0.002, decay: 0.16 }, at);
      break;
    }
    case 'item-get':
    case 'unlock': {
      // two 2kHz square clicks 90ms apart + a thin mechanical rub
      squareClick(dest, t, 2000, 0.003, 0.06);
      squareClick(dest, t + 0.09, 2000, 0.003, 0.05);
      noiseBurst(dest, { dur: 0.12, filter: { type: 'lowpass', freqA: 900 }, peak: 0.018, attack: 0.015 });
      break;
    }
    case 'pen-scratch': {
      // three short 8–18ms rips + a faint sandpaper wash (nib on paper)
      for (let i = 0; i < 3; i++) {
        noiseBurst(
          dest,
          {
            dur: 0.008 + Math.random() * 0.01,
            filter: { type: 'bandpass', freqA: 3000 + Math.random() * 2200, q: 5 },
            peak: 0.07,
            attack: 0.001,
          },
          t + i * 0.03
        );
      }
      noiseBurst(dest, { dur: 0.15, filter: { type: 'bandpass', freqA: 6000, q: 0.7 }, peak: 0.02, attack: 0.02 }, t + 0.01);
      break;
    }
    case 'gate-open': {
      // heavy thud, then a 400ms door-yawn: noise swell through a dropping bandpass
      toneThump(dest, { from: 70, to: 45, dur: 0.12, peak: 0.18, attack: 0.004, decay: 0.3 });
      noiseBurst(dest, { dur: 0.4, filter: { type: 'bandpass', freqA: 300, freqB: 150, q: 0.8 }, peak: 0.12, attack: 0.12 }, t + 0.02);
      break;
    }
    case 'scene-sting':
    case 'crit-chime': {
      // ascending triad C5/E5/G5 blooming in, long warm decay
      const chime = (freq: number, time: number): void => {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq;
        const g = c.createGain();
        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(0.09, time + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.65);
        o.connect(g);
        g.connect(dest);
        o.start(time);
        o.stop(time + 0.7);
      };
      chime(523.25, t);
      chime(659.25, t + 0.08);
      chime(783.99, t + 0.16);
      break;
    }
    case 'fumble-break': {
      // two descending tones (E4 → E3) + a low noise snap over 300ms
      toneThump(dest, { from: 330, to: 330, dur: 0.02, peak: 0.1, attack: 0.002, decay: 0.18 });
      toneThump(dest, { from: 196, to: 180, dur: 0.03, peak: 0.12, attack: 0.002, decay: 0.25 }, t + 0.14);
      noiseBurst(dest, { dur: 0.3, filter: { type: 'lowpass', freqA: 220 }, peak: 0.16, attack: 0.005 }, t + 0.02);
      break;
    }
    case 'page-turn': {
      // paper lift + settle: a short bright rip over a low rustle wash
      noiseBurst(dest, { dur: 0.05 + Math.random() * 0.03, filter: { type: 'bandpass', freqA: 3200, freqB: 2200, q: 1.1 }, peak: 0.05 + 0.06 * k, attack: 0.004 });
      noiseBurst(dest, { dur: 0.12, filter: { type: 'lowpass', freqA: 1400 }, peak: 0.03, attack: 0.02 }, t + 0.03);
      break;
    }
  }
}

/** Play an interaction sound: real sample first, synthesized voice on failure.
 *  `intensity` (0–1) scales the sample level, keeping the drag-weight semantic
 *  continuous with the synth path. */
const canvasFoley: Record<FoleyName, [string, number]> = {
  'paper-slide': ['card', .14], 'bag-pack': ['get', .18],
  'dice-roll': ['dice', .28], 'unlock': ['success', .22],
  'pen-scratch': ['write', .16], 'gate-open': ['door', .2],
  'crit-chime': ['success', .22], 'fumble-break': ['card', .14],
  'page-turn': ['paper', .14],
  // se-bell was "retained for future use" (assets/audio/CREDITS.md §6): the scene card's sting.
  'scene-sting': ['bell', .22], 'item-get': ['get', .2],
};
/** assets/audio/foley/<name>.mp3 (CC0, CREDITS §5). */
const CC0_FOLEY = new Set<FoleyName>(['paper-slide', 'bag-pack', 'dice-roll', 'unlock', 'pen-scratch', 'gate-open', 'crit-chime', 'fumble-break', 'page-turn']);
const foleyBusyUntil = new Map<FoleyName, number>();
export function playFoley(name: FoleyName, intensity = 1): void {
  ensureVisibilityGate();
  if (pageIsHidden() || !initAudio() || !master || ctx?.state !== 'running' || mutedState) return;
  const now = performance.now();
  const requestEpoch = visibilityEpoch;
  if (now < (foleyBusyUntil.get(name) ?? 0)) return;
  foleyBusyUntil.set(name, now + 500);
  const k = clamp01(intensity);
  const [sample, level] = canvasFoley[name];
  // The canvas set (MaouDamashii) is not redistributable; a copy without it
  // (the open-source one) plays the CC0 foley of the same name, then synthesis.
  const url = `/api/audio?path=foley%2Fcanvas%2Fse-${sample}.mp3`;
  const cc0 = CC0_FOLEY.has(name) ? `/api/audio?path=foley%2F${name}.mp3` : null;
  if (failCached.has(url) && (!cc0 || failCached.has(cc0))) {
    synthFoley(name, k * .2); // keep a quiet offline fallback
    return;
  }
  void loadSample(url).then((buf) => buf ?? (cc0 ? loadSample(cc0) : null)).then((buf) => {
    if (
      requestEpoch !== visibilityEpoch ||
      performance.now() - now > 500 ||
      mutedState ||
      pageIsHidden() ||
      ctx?.state !== 'running'
    ) return;
    if (buf) {
      if (!master) return;
      foleyBusyUntil.set(name, performance.now() + Math.max(500, buf.duration * 1000));
      playClip(master, buf, false, (level || FOLEY_SAMPLE_LEVEL) * k);
    } else {
      synthFoley(name, k * .2);
    }
  });
}

/** Instant emotional sting (<1.5s), orthogonal to the main tracks: fully
 *  additive, never touches ambient/bgm/theme gain. Requests are dropped when
 * hidden, muted, or superseded by a visibility transition. */
export function playStinger(emo: Emotion): void {
  ensureVisibilityGate();
  if (pageIsHidden() || mutedState) return;
  const c = initAudio();
  if (!c || !master) return;
  if (c.state !== 'running') return; // drop, don't queue
  const requestEpoch = visibilityEpoch;
  const url = `/api/audio?path=stinger%2F${emo}.mp3`;
  void loadSample(url).then((buf) => {
    if (
      requestEpoch !== visibilityEpoch ||
      pageIsHidden() ||
      mutedState ||
      c.state !== 'running' ||
      !buf ||
      !master
    ) return; // material absent → silent no-op
    playClip(master, buf, false, STINGER_SAMPLE_LEVEL);
  });
}


/** Warm the sample cache ahead of playback. Never rejects: a failed URL is
 *  recorded in failCached and resolves quietly. */
export async function preloadAudio(urls: string[]): Promise<void> {
  if (!initAudio()) return; // no decoder → nothing to fail
  await Promise.allSettled(urls.filter((u) => u.length > 0).map((u) => loadSample(u)));
}

/** Test/diagnostic view: declared refs verbatim (URL | bare name | null) plus
 *  the URLs that actually decoded. Independent of `ctx`. */
export function audioDebugState(): {
  ambient: string | null;
  bgm: string | null;
  theme: string | null;
  loaded: string[];
} {
  const loaded: string[] = [];
  for (const url of decodeCache.keys()) {
    if (!failCached.has(url)) loaded.push(url);
  }
  return { ambient: tracks.ambient.ref, bgm: tracks.bgm.ref, theme: tracks.theme.ref, loaded };
}

/* ============================================================
 * Voice channel (TTS) — one line of character dialogue at a time.
 * Orthogonal to the three main tracks: lives in its own slot, is never
 * registered in `tracks`, and has NO synth fallback (the engine owns no
 * speech synthesizer) — a failed load is simply silence.
 * ============================================================ */

/** Seconds — interrupt fade for voice. Shorter than the 1.5s main-track
 *  crossfade: a dialogue switch must feel immediate (0.12s kills the click,
 *  nothing more). */
const VOICE_FADE = 0.12;
/** Seconds — click-safe voice attack. Speech must reach its intended level
 *  before the first word, unlike the 1.5s music crossfade. */
const VOICE_ATTACK = 0.005;

let voiceClip: Clip | null = null; // what is sounding now (loop is always false)
let voiceToken = 0; // async-race guard (same discipline as tracks[id].token)
let voiceUrl: string | null = null; // declared ref verbatim (debug/test truth)
let voiceLoading: number | null = null; // the token of a line still loading / decoding

/** Play one TTS line. A new call interrupts the previous one. Silently drops
 *  when hidden, muted, without a context, when the context is not running
 *  (autoplay policy), or when the sample fails to load. Never queues a line:
 *  a request crossing a visibility transition is stale rather than replayed. */
export function playVoice(url: string): void {
  ensureVisibilityGate();
  stopVoice(); // interrupt the previous line first, including while hidden
  voiceUrl = url; // record the declared ref even when we go silent

  if (pageIsHidden() || mutedState) return;
  const c = initAudio();
  if (!c || !master) return; // no Web Audio → silent no-op
  if (c.state !== 'running') return; // drop, don't queue

  const token = voiceToken; // token taken after stopVoice's bump
  const requestEpoch = visibilityEpoch;
  voiceLoading = token;
  void loadSample(url).then((buf) => {
    if (voiceLoading === token) voiceLoading = null;
    if (
      token !== voiceToken ||
      requestEpoch !== visibilityEpoch ||
      pageIsHidden() ||
      mutedState
    ) return; // superseded by a newer call / stop / hidden transition
    if (!buf || !master || !ctx) return; // load failed → silence (no fallback)
    if (ctx.state !== 'running') return; // suspended again during decode → drop
    const nodes = playClip(voiceBus!, buf, /* loop */ false, VOICE_SAMPLE_LEVEL, VOICE_ATTACK);
    if (!nodes) return;
    nodes.src.onended = (): void => {
      // Past playClip's own disconnect; add the slot clear so isVoicing()
      // goes false when the line ends naturally.
      nodes.src.disconnect();
      nodes.gain.disconnect();
      if (voiceClip?.src === nodes.src) voiceClip = null;
    };
    voiceClip = { url, src: nodes.src, gain: nodes.gain, loop: false };
  });
}

/** Fade out and release the current voice line. Idempotent, never throws.
 *  The slot is cleared synchronously (so `isVoicing()` is immediately false);
 *  the physical stop/disconnect is deferred past the fade. */
export function stopVoice(): void {
  voiceToken += 1; // invalidate any in-flight load
  voiceUrl = null;
  voiceLoading = null;
  const clip = voiceClip;
  voiceClip = null; // synchronous release, mirroring stopClip
  if (!clip) return; // idempotent
  const c = ctx;
  if (!c) return;
  const t = c.currentTime;
  clip.gain.gain.cancelScheduledValues(t);
  clip.gain.gain.setValueAtTime(clip.gain.gain.value, t);
  clip.gain.gain.linearRampToValueAtTime(0, t + VOICE_FADE);
  setTimeout(() => {
    try {
      clip.src.stop();
    } catch {
      /* already stopped */
    }
    clip.src.disconnect();
    clip.gain.disconnect();
  }, VOICE_FADE * 1000 + 40);
}

/** Whether a voice line is currently sounding. False without a context. */
export function isVoicing(): boolean {
  return voiceClip !== null;
}

/**
 * A voice line is sounding OR still loading / decoding after `playVoice`: the
 * whole span a listener hears it (or is about to). `isVoicing()` alone is false
 * during the load, which let the next thing start before the line was heard.
 */
export function isVoiceBusy(): boolean {
  return voiceClip !== null || voiceLoading !== null;
}

/**
 * The shared context and the voice bus, for a caller that schedules its own
 * buffers rather than loading a URL.
 *
 * A live call arrives as a stream of PCM chunks that must be scheduled back to
 * back, which `playVoice` — one decoded URL at a time, each interrupting the
 * last — cannot express. Rather than open a second AudioContext (two contexts
 * means two clocks, two autoplay unlocks, and a voice slider that only moves
 * one of them), the caller borrows THIS graph: same `voiceBus`, so the voice
 * volume, the mute and the unlock all keep working unchanged.
 *
 * Returns null when Web Audio is unavailable, and the caller degrades to
 * subtitles. `stopVoice()` first, so a TTS line already sounding yields to the
 * call instead of overlapping it.
 */
export function openVoiceStream(): { context: AudioContext; destination: GainNode } | null {
  ensureVisibilityGate();
  stopVoice();
  const c = initAudio();
  if (!c || !voiceBus) return null;
  return { context: c, destination: voiceBus };
}

/** Test/diagnostic view: the declared voice ref verbatim. Independent of
 *  `ctx`, and kept out of `audioDebugState()`'s frozen four-key shape. */
export function voiceDebugState(): { url: string | null } {
  return { url: voiceUrl };
}

/* ============================================================
 * Mute / unlock / charge tone
 * ============================================================ */

/**
 * How a page `<video>` with its own sound should play (the scene clip of a
 * presentation): silent while the engine is muted, locked by autoplay policy
 * (no gesture yet) or the page is hidden; otherwise at the music channel's
 * volume. A media element is outside the Web Audio graph, so it reads the
 * same switches instead of riding the master bus.
 */
export function mediaElementAudio(): { muted: boolean; volume: number } {
  const locked = !ctx || ctx.state !== 'running';
  return { muted: mutedState || locked || pageIsHidden(), volume: channelVolumes.music };
}

export function isMuted(): boolean {
  return mutedState;
}

/** Mute everything with a short ramp (avoids the click of a hard 0 snap). */
export function setMuted(m: boolean): void {
  mutedState = m;
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.linearRampToValueAtTime(m ? 0 : 1, t + 0.03);
}

/** Resume the context — required by browser autoplay policy. Idempotent;
 *  call on the first user gesture. Releases the mute and re-asserts the ramps
 *  already declared (synth beds + sample clips); it does NOT pick defaults —
 *  choosing a bed is the app's job, not the engine's. */
export async function unlock(): Promise<void> {
  const c = initAudio();
  if (!c || !master) return;
  if (c.state === 'suspended') {
    try {
      await c.resume();
    } catch (err) {
      console.warn('Audio resume blocked:', err);
    }
  }
  rampAmbient();
  rampBgm();
  rampClips();
  const t = c.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(mutedState ? 0 : 1, t);
}

/** Install a one-time pointerdown/keydown listener that unlocks audio on the
 *  first interaction anywhere (used by Main; Canvas already unlocks its own
 *  pointerdown, so this is belt-and-suspenders). */
export function unlockOnFirstInteraction(): void {
  const kick = (): void => {
    void unlock();
    window.removeEventListener('pointerdown', kick);
    window.removeEventListener('keydown', kick);
  };
  window.addEventListener('pointerdown', kick);
  window.addEventListener('keydown', kick);
}

/* --- ceremony charge tone (extra UI voice, not part of the foley set) --- */

let chargeOsc: OscillatorNode | null = null;
let chargeGain: GainNode | null = null;

/** Charge-tone progress for the dice ceremony: 220→440Hz sine whose level
 *  micro-rises with the bar. Call per frame while holding. */
export function playCharge(progress: number): void {
  if (!initAudio() || !master) return;
  const c = ctx!;
  const p = clamp01(progress);
  if (!chargeOsc || !chargeGain) {
    chargeOsc = c.createOscillator();
    chargeOsc.type = 'sine';
    chargeGain = c.createGain();
    chargeGain.gain.value = 0;
    chargeOsc.connect(chargeGain);
    chargeGain.connect(master);
    chargeOsc.start();
  }
  const t = c.currentTime;
  chargeOsc.frequency.setTargetAtTime(220 + 220 * p, t, 0.02);
  chargeGain.gain.setTargetAtTime(0.015 + 0.025 * p, t, 0.03);
}

/** Fade and release the charge tone. */
export function endCharge(): void {
  if (!chargeOsc || !chargeGain || !ctx) return;
  const t = ctx.currentTime;
  chargeGain.gain.setTargetAtTime(0, t, 0.02);
  const osc = chargeOsc;
  const g = chargeGain;
  window.setTimeout(() => {
    try {
      osc.stop();
    } catch {
      /* already stopped */
    }
    osc.disconnect();
    g.disconnect();
    if (chargeOsc === osc) {
      chargeOsc = null;
      chargeGain = null;
    }
  }, 120);
}
