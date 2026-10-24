/**
 * The voice roster this build ships with: worldlines-play's published list, snapshotted by
 * `tools/sync-voice-roster.mjs`, plus the bridge from this repo's vocabulary (effect aliases, DashScope raw ids,
 * studio voices) into the roster casting rules (`voice-roster-cast.ts`).
 */
import { castRosterVoice, rosterAllows, type RosterCast, type RosterProfile, type VoiceRoster } from './voice-roster-cast.js';
import { VOICE_ROSTER } from './voice-roster.snapshot.js';
import { LOCAL_VOICE_HOSTED_FALLBACK, voiceEntry } from './voices.js';

export { VOICE_ROSTER };

/** `last-train-zh` / `islet-jp` / `guixiang-ko` → the world family the roster's assignments are keyed by. */
export function worldFamilyOf(worldId: unknown): string {
  const id = typeof worldId === 'string' ? worldId.trim() : '';
  return id.replace(/-(?:zh|jp|ja|ko|en)$/, '');
}

/** A `voice:` as the roster rules understand it: a roster id as is, anything of ours as its effect alias. */
export function rosterDeclaration(declared: string | undefined, roster: VoiceRoster = VOICE_ROSTER): string | undefined {
  const name = typeof declared === 'string' ? declared.trim() : '';
  if (!name) return undefined;
  if (rosterAllows(roster, name)) return name;
  return voiceEntry(name)?.alias ?? voiceEntry(LOCAL_VOICE_HOSTED_FALLBACK[name] ?? '')?.alias ?? name;
}

/** THE casting call for a character's voice → { provider, id }: declaration + profile + who (world id / character id) + world language. */
export function castWorldVoice(
  declared: string | undefined,
  profile: RosterProfile = {},
  who: { worldId?: string; character?: string } = {},
  roster: VoiceRoster = VOICE_ROSTER,
  language?: string,
): RosterCast {
  return castRosterVoice(roster, {
    declared: rosterDeclaration(declared, roster),
    profile,
    language,
    ...(who.worldId && who.character ? { family: worldFamilyOf(who.worldId), character: who.character } : {}),
  });
}
