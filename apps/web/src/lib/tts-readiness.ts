/** `requiresAccount`: the voices go through the Worldlines service and nobody is signed in (a guest gets the story only). */
export type TtsConfig = { configured: boolean; model: string; defaultVoice: string; experimentalLocal?: boolean; localTts?: boolean; requiresAccount?: boolean };
let cached: TtsConfig | null = null;
let pending: Promise<TtsConfig> | null = null;
let retryAt = 0;
let warned = false;
/** PREFS_CHANGED_EVENT of prefs-events.ts, inline: this module stays import-free (tools/tts-readiness.test.mjs loads it raw). */
const prefsChanged = () => { try { window.dispatchEvent(new Event('airp:prefs-changed')); } catch { /* no window */ } };
export const ttsEnabled = () => localStorage.getItem('airp-tts-enabled') !== 'false';
export function setTtsEnabled(enabled: boolean) { localStorage.setItem('airp-tts-enabled', String(enabled)); prefsChanged(); }
/**
 * Local studio TTS (setsuna …) is HIDDEN by default. It is listed
 * only with `VITE_AIRP_LOCAL_TTS=1` at build time, or after `?localTts=1` on this browser
 * (remembered; `?localTts=0` forgets it) — the team's testing toggle. Off: no studio-voice setting is
 * shown and no request asks for it, whatever an older visit stored.
 */
const LOCAL_TTS_FLAG = 'airp.localTts';
export function localTtsFeature(): boolean {
  if ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_AIRP_LOCAL_TTS === '1') return true;
  try {
    const query = new URLSearchParams(window.location.search).get('localTts');
    if (query === '1') localStorage.setItem(LOCAL_TTS_FLAG, '1');
    else if (query === '0') localStorage.removeItem(LOCAL_TTS_FLAG);
    return localStorage.getItem(LOCAL_TTS_FLAG) === '1';
  } catch { return false; }
}
/** Experimental studio voice (setsuna) through the Worldlines AI service; off unless chosen here (and the feature is on). */
export const ttsLocalExperiment = () => { try { return localTtsFeature() && localStorage.getItem('airp-tts-local-experimental') === 'true'; } catch { return false; } };
export function setTtsLocalExperiment(on: boolean) { try { localStorage.setItem('airp-tts-local-experimental', String(on)); } catch { /* storage blocked */ } prefsChanged(); }
export function warnTtsUnavailable() {
  if (warned) return;
  warned = true;
  window.dispatchEvent(new Event('airp:tts-unavailable'));
}
// One failed line (a timeout, a rate limit, an experimental voice that is down) is not "voice is
// unavailable": skip that line quietly. Only a missing configuration, or several failures in a row,
// pauses voice for a minute and shows the notice.
const FAILURES_BEFORE_PAUSE = 3;
let consecutiveFailures = 0;
export function noteTtsSuccess() { consecutiveFailures = 0; }
export function invalidateTts(missing = false) {
  consecutiveFailures += 1;
  if (!missing && consecutiveFailures < FAILURES_BEFORE_PAUSE) return;
  consecutiveFailures = 0;
  retryAt = Date.now() + 60_000;
  if (missing) cached = { configured: false, model: cached?.model ?? '', defaultVoice: cached?.defaultVoice ?? '' };
  warnTtsUnavailable();
}
/**
 * Signed out / a guest of the trial: no voice at all this session — never one request per line answered 401
 *. One quiet hint
 * (`airp:tts-requires-account`, once per page); signing in or out re-reads the readiness.
 */
export const TTS_REQUIRES_ACCOUNT_EVENT = 'airp:tts-requires-account';
let accountHinted = false;
let accountListener = false;
function watchAccount() {
  if (accountListener) return;
  accountListener = true;
  // ACCOUNT_CHANGED_EVENT of account-open.ts, inline (this module stays import-free).
  try { window.addEventListener('airp:account-changed', () => { cached = null; retryAt = 0; consecutiveFailures = 0; }); } catch { /* no window */ }
}
export function noteTtsRequiresAccount() {
  watchAccount();
  cached = { configured: false, requiresAccount: true, model: cached?.model ?? '', defaultVoice: cached?.defaultVoice ?? '' };
  consecutiveFailures = 0;
  if (accountHinted) return;
  accountHinted = true;
  try { window.dispatchEvent(new Event(TTS_REQUIRES_ACCOUNT_EVENT)); } catch { /* no window */ }
}
export function readTtsConfig(force = false): Promise<TtsConfig> {
  if (pending) return pending;
  if (!force && cached) return Promise.resolve(cached);
  pending = fetch('/api/tts/config').then(async response => {
    if (!response.ok) throw Error('Voice service is unavailable');
    const data = await response.json() as TtsConfig;
    cached = data;
    if (data.configured) { retryAt = 0; warned = false; }
    return data;
  }).finally(() => { pending = null; });
  return pending;
}
export async function canRequestTts() {
  if (!ttsEnabled() || Date.now() < retryAt) return false;
  try {
    const config = await readTtsConfig();
    if (config.configured) return true;
    if (config.requiresAccount) noteTtsRequiresAccount();
    else warnTtsUnavailable();
  } catch { invalidateTts(); }
  return false;
}
