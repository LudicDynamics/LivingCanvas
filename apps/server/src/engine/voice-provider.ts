import { GATEWAY_WORLD_ID, WORLD_HEADER } from '../gateway-world.js';

/**
 * Which voice backend is this call using.
 *
 * There are TWO independent switches, and conflating them is the mistake this
 * module exists to prevent:
 *
 *  1. **Transport / provider** — `gpt-live` or `voice-live`. Ours to choose,
 *     read from `AIRP_VOICE_PROVIDER`, defaulting to voice-live in development
 *     and gpt-live everywhere else (the VPS cannot run voice-live at all —
 *     mlx-whisper needs Apple Silicon, integration.md §2.1).
 *  2. **Brain** — `deepseek` / `pirp` / `airp`. NOT ours: it is voice-live's own
 *     `VOICE_LIVE_BRAIN`, set on that process. We never guess it and never
 *     mirror it into our own env, because two sources of truth for one setting
 *     is how they drift. voice-live reports the brain it actually booted with in
 *     its `hello` frame, and that is the only value we ever display.
 *
 * The upstream address is deliberately server-only. It never appears in the
 * `/api/live/config` payload, so a voice-live sitting on Tailscale or another
 * machine stays private and the browser only ever talks to our own origin
 * through the reverse proxy (`voice-live-proxy.ts`).
 *
 * Pure: every function takes its env as an argument, so the whole decision is
 * unit-testable (`apps/server/test/voice-provider.test.mjs`).
 */

/** The transports a call can run on. `kind` on `DuplexCharacterChannel` uses the same spellings. */
export const VOICE_PROVIDERS = ['gpt-live', 'voice-live'] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];

/**
 * voice-live's brains (integration.md §4). Listed here so the browser can label
 * what it was told, and so `the design notes` has one place to point at —
 * NOT so that we can set it. `airp` is the one under test: it drives a character
 * agent owned by this server, over the canvas WebSocket we already serve.
 */
export const VOICE_LIVE_BRAINS = ['deepseek', 'pirp', 'airp'] as const;
export type VoiceLiveBrain = (typeof VOICE_LIVE_BRAINS)[number];

/** Where voice-live listens. Server-only; never serialised to the browser. */
export const DEFAULT_VOICE_LIVE_URL = 'http://127.0.0.1:8777';

export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return typeof value === 'string' && (VOICE_PROVIDERS as readonly string[]).includes(value);
}

export function isVoiceLiveBrain(value: unknown): value is VoiceLiveBrain {
  return typeof value === 'string' && (VOICE_LIVE_BRAINS as readonly string[]).includes(value);
}

/**
 * Pure: the active transport.
 *
 * voice-live is the default while we are testing it
 * and gpt-live is the default for a released build — which is
 * also the only thing that can work there, since the VPS has no Apple Silicon.
 * An unrecognised `AIRP_VOICE_PROVIDER` falls back to the default rather than
 * refusing to boot: a typo must not cost the whole server.
 */
export function resolveVoiceProvider(
  env: NodeJS.ProcessEnv = process.env,
  options: { localVoiceLiveConfigured?: boolean } = {},
): VoiceProvider {
  const declared = (env.AIRP_VOICE_PROVIDER ?? '').trim();
  if (isVoiceProvider(declared)) return declared;
  // This computer's own voice-live (voice.json, local-voice-live.ts) is a choice the user made: honour it in any build.
  if (options.localVoiceLiveConfigured) return 'voice-live';
  return env.NODE_ENV === 'production' ? 'gpt-live' : 'voice-live';
}

/** Pure: the voice-live base URL, trailing slashes removed. Server-only. */
export function resolveVoiceLiveUrl(env: NodeJS.ProcessEnv = process.env): string {
  const declared = (env.VOICE_LIVE_URL ?? '').trim();
  return (declared || DEFAULT_VOICE_LIVE_URL).replace(/\/+$/, '');
}

/**
 * `http://host:8777` → `ws://host:8777/ws` (integration.md §3.1).
 * A URL that already names a path is a gateway's channel and is kept as is:
 * `https://ai.worldlines.gg/v1/voice/live` → `wss://ai.worldlines.gg/v1/voice/live`.
 */
export function voiceLiveSocketUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '').replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  return /^wss?:\/\/[^/]+\/./.test(base) ? base : `${base}/ws`;
}

/**
 * Handshake headers for the upstream. Behind ai.worldlines.gg every call needs a
 * Worldlines credential (`VOICE_LIVE_TOKEN`: a `wl_pat_` with api:use, or a
 * product service key plus `VOICE_LIVE_ACTING_USER`). Server-only, never logged.
 */
export function voiceLiveUpstreamHeaders(env: NodeJS.ProcessEnv = process.env, world: string | null = null): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  const token = (env.VOICE_LIVE_TOKEN ?? '').trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
    headers['x-worldlines-product'] = (env.VOICE_LIVE_PRODUCT ?? '').trim() || 'livingcanvas';
    // The open world (ai-gateway.ts gatewayWorld): only to ai.worldlines.gg, never to a voice-live run directly.
    if (world && GATEWAY_WORLD_ID.test(world)) headers[WORLD_HEADER] = world;
    const acting = (env.VOICE_LIVE_ACTING_USER ?? '').trim();
    if (acting) headers['x-worldlines-user'] = acting;
  }
  // Development only: talking to voice-live DIRECTLY (not through ai.worldlines.gg),
  // which only answers callers holding its shared key (voice-live VOICE_LIVE_ACCESS_TOKEN).
  const access = (env.VOICE_LIVE_ACCESS_TOKEN ?? '').trim();
  if (access) headers['x-voice-live-token'] = access;
  return Object.keys(headers).length ? headers : undefined;
}

/**
 * Whether this server answers for the call's character itself (voice-live
 * `?brain=relay`, `voice-live-brain.ts`). On by default: it is the only form
 * that works when voice-live cannot reach us. `VOICE_LIVE_BRAIN_RELAY=0` hands
 * the brain back to whatever voice-live booted with.
 */
export function voiceLiveRelaysBrain(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.VOICE_LIVE_BRAIN_RELAY ?? '').trim() !== '0';
}

/** `http://host:8777` → `http://host:8777/api/events` (the debug log tail). */
export function voiceLiveEventsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/events`;
}

/** What one transport can offer right now. `reason` is prose for a human, never a code. */
export interface VoiceProviderReadiness {
  available: boolean;
  reason?: string;
}

/** The `/api/live/config` payload. Everything here is safe to send to a browser. */
export interface VoiceCallConfig {
  /** The transport a call started now would use. */
  provider: VoiceProvider;
  /** Readiness of THAT provider — what gates the call button. */
  available: boolean;
  reason?: string;
  /** GPT Live's model name; kept at the top level because the UI already reads it. */
  model: string;
  voices: readonly string[];
  /** Per-provider readiness, so a settings panel can explain the choice. */
  providers: Record<VoiceProvider, VoiceProviderReadiness>;
  /**
   * The local edition's own voice-live (local-voice-live.ts): off / starting / ready / failed + reason.
   * Present only when calls go to it; never a path, a port or an env value.
   */
  localVoiceLive?: LocalVoiceLiveStatusView;
}

/** The browser-safe shape of local-voice-live.ts `LocalVoiceLiveStatus` (kept structural: this module stays pure). */
export interface LocalVoiceLiveStatusView {
  state: 'off' | 'starting' | 'ready' | 'failed';
  configured: boolean;
  owned: boolean;
  reason?: string;
}

/**
 * Pure: fold the two providers' readiness into one answer for the browser.
 *
 * Calls to this computer's own voice-live (voice.json, local-voice-live.ts) are
 * gated by that supervisor's status (`localVoiceLive`), which the route re-probes
 * per page load. Every other voice-live (a declared VOICE_LIVE_URL, tickets) has
 * no credential to check and no cheap synchronous probe, so it reports available. That is honest rather than optimistic: a voice-live that is
 * not running fails at connect time, loudly, through the same visible-failure
 * path as every other call error. A readiness probe here would be WORSE — it is
 * fetched once per page load, so it would cache a "down" answer for a backend
 * that came up five seconds later, and the only way to make it accurate would be
 * to poll a machine whose address we are deliberately not telling the browser.
 *
 * The upstream URL is not a field of this type. Nothing in this payload may ever
 * carry it (`voice-provider.test.mjs` asserts the serialised form is clean).
 */
export function composeVoiceCallConfig(input: {
  provider: VoiceProvider;
  gptLive: VoiceProviderReadiness & { model: string; voices: readonly string[] };
  /**
   * When calls go to this computer's own voice-live (local-voice-live.ts), its status decides
   * voice-live's readiness: ready / starting → available, off / failed → hidden with the reason.
   * Absent (a declared VOICE_LIVE_URL, tickets) → available as before: that failure is loud at connect.
   */
  localVoiceLive?: LocalVoiceLiveStatusView;
}): VoiceCallConfig {
  const local = input.localVoiceLive;
  const voiceLive: VoiceProviderReadiness = !local || local.state === 'ready' || local.state === 'starting'
    ? { available: true }
    : { available: false, reason: local.reason ?? (local.state === 'failed' ? 'voice-live failed to start' : 'Voice Live is not set up on this computer (voice.json)') };
  const providers: Record<VoiceProvider, VoiceProviderReadiness> = {
    'gpt-live': input.gptLive.available
      ? { available: true }
      : { available: false, reason: input.gptLive.reason ?? 'GPT Live is not configured' },
    'voice-live': voiceLive,
  };
  const active = providers[input.provider];
  return {
    provider: input.provider,
    available: active.available,
    ...(active.reason ? { reason: active.reason } : {}),
    model: input.gptLive.model,
    voices: input.gptLive.voices,
    providers,
    ...(local ? { localVoiceLive: { state: local.state, configured: local.configured, owned: local.owned, ...(local.reason ? { reason: local.reason } : {}) } } : {}),
  };
}
