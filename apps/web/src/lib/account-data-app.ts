import { ACCOUNT_CHANGED_EVENT } from './account-open.js';
import { settleAttribution } from './attribution.js';
import { createAccountData, installAccountData, type SyncedPrefs } from './account-data.js';
import { announcements, createAnnouncements, installAnnouncements, REFRESH_MS } from './announcements.js';
import { getChannelVolume, setChannelVolume } from './audio.js';
import { createLobbyLogs, installLobbyLogs, lobbyLogs } from './lobby-logs.js';
import { preferredLocale, setLocale, subscribeLocale, validLocale } from './i18n.js';
import { readPerformanceSettings, replacePerformanceSettings, subscribePerformanceSettings } from './performance-settings.js';
import { PREFS_CHANGED_EVENT } from './prefs-events.js';
import { parsePlanLook, planLookPref, setPlanLookPref } from './plan-look.js';
import { setTtsEnabled, setTtsLocalExperiment, ttsEnabled, ttsLocalExperiment } from './tts-readiness.js';

/** This device's synced preferences, as lib/account-data.ts sends them (the server keeps only the manifest's fields). */
export function readSyncedPrefs(): SyncedPrefs {
  let tts = true;
  try { tts = ttsEnabled(); } catch { /* storage blocked */ }
  return {
    // the player's own language, never an open world's temporary one (lib/i18n.ts followWorldLocale)
    locale: preferredLocale(),
    performance: { ...readPerformanceSettings() },
    voice: { ttsEnabled: tts, studioVoice: ttsLocalExperiment(), musicVolume: getChannelVolume('music'), voiceVolume: getChannelVolume('voice') },
    // closed announcements follow the account too (never un-closed by a sync: applySyncedPrefs merges)
    dismissed: announcements()?.dismissedIds() ?? [],
    // 卡面角色: absent = 默认 (the data service's enum has no "default" value)
    ...(planLookPref() ? { planLook: planLookPref() } : {}),
  };
}

/** Another device's preferences → this one. Each field only when it is there and valid. */
export function applySyncedPrefs(prefs: SyncedPrefs): void {
  if (Array.isArray(prefs.dismissed)) announcements()?.mergeDismissed(prefs.dismissed);
  if (prefs.performance) replacePerformanceSettings(prefs.performance);
  // the account's whole settings record: no planLook there = 默认 (switched back on another device)
  setPlanLookPref(parsePlanLook(prefs.planLook), { announce: false });
  if (prefs.locale && validLocale(prefs.locale) === prefs.locale && prefs.locale !== preferredLocale()) setLocale(prefs.locale);
  const v = prefs.voice ?? {};
  try {
    if (typeof v.ttsEnabled === 'boolean' && v.ttsEnabled !== ttsEnabled()) setTtsEnabled(v.ttsEnabled);
  } catch { /* storage blocked */ }
  if (typeof v.studioVoice === 'boolean' && v.studioVoice !== ttsLocalExperiment()) setTtsLocalExperiment(v.studioVoice);
  if (typeof v.musicVolume === 'number' && v.musicVolume !== getChannelVolume('music')) setChannelVolume('music', v.musicVolume);
  if (typeof v.voiceVolume === 'number' && v.voiceVolume !== getChannelVolume('voice')) setChannelVolume('voice', v.voiceVolume);
}

let started = false;
/** Once, after the app's server is reachable (browser mode: after the runtime is up). */
export function startAccountData(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* blocked: memory only */ }
  installAnnouncements(createAnnouncements({ fetch: window.fetch.bind(window), storage, now: () => Date.now(), setTimer: (fn, ms) => window.setTimeout(fn, ms), clearTimer: (id) => window.clearTimeout(id as number) }));
  void announcements()?.load();
  installLobbyLogs(createLobbyLogs({ fetch: window.fetch.bind(window), now: () => Date.now() }));
  void lobbyLogs()?.load();
  // banners and the lobby's 日志: every five minutes while the tab is visible, and when it comes back
  const refresh = () => { if (document.visibilityState !== 'hidden') { void announcements()?.load(); void lobbyLogs()?.load(); } };
  window.setInterval(refresh, REFRESH_MS);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  const data = createAccountData({ fetch: window.fetch.bind(window), storage, now: () => Date.now(), readPrefs: readSyncedPrefs, applyPrefs: applySyncedPrefs });
  installAccountData(data);
  // 渠道 / 来源: once an account is signed in here the remembered link has done its job (identity counted it if this
  // sign-in created the account; an existing account is never an acquisition) — forget it, keeping only the
  // first-touch channel keyword for the usage events' `src` (lib/attribution.ts settleAttribution).
  data.subscribe(() => { if (data.getState().sync === 'synced') settleAttribution(); });
  subscribePerformanceSettings(data.prefsChanged);
  subscribeLocale(data.prefsChanged);
  window.addEventListener(PREFS_CHANGED_EVENT, data.prefsChanged);
  window.addEventListener(ACCOUNT_CHANGED_EVENT, () => { void data.refresh(); });
  window.addEventListener('pagehide', () => data.flushAll());
  void data.refresh();
}
