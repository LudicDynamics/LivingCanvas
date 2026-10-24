import { z } from 'zod';

/**
 * Per-world player preferences for automatic writer turns.
 *
 * Three states, because the two automatic turns are different kinds of work:
 *   - `scenes`: walking into an unwritten gate materialises the scene. That is
 *     the I1 initialiser's job (scene-init preset, structured brief, W2
 *     fallback), NOT a writer turn — the engine owns it.
 *   - `scenes-and-choices`: additionally, resolving a choice advances the
 *     story with a writer turn.
 *
 * The frozen contract is that an event landing in
 * the table never starts an agent turn BY ITSELF; whether one follows is this
 * setting's call. The default is `scenes-and-choices`
 *
 * `off` remains the quiet mode where the writer only sees events in the hook
 * injection of the player's next input.
 */
export const AutoWriteSchema = z.enum(['off', 'scenes', 'scenes-and-choices']);
export type AutoWrite = z.infer<typeof AutoWriteSchema>;

export const WorldSettingsSchema = z.object({
  autoWrite: AutoWriteSchema,
  /**
   * After a character chat in which something was learned or promised, the
   * writer may take one quiet turn to show it on the canvas
   *. Absent = on; `false` turns it off.
   */
  chatBeats: z.boolean().optional(),
  /**
   * Character tick, for a world that declares
   * `tick`: `off` / `easy` (one more beat to react, half the landings) /
   * `standard`. Absent = standard.
   */
  characterTick: z.enum(['off', 'easy', 'standard']).optional(),
  /**
   * Character tick v2: 「角色自己说话」 — the people pick their own
   * move and write a line in their own voice (one cheap model call, capped per run). Absent = on, for
   * registered players and guests alike; `false` = the v1 rules only.
   */
  characterVoices: z.boolean().optional(),
  /**
   * The writer's fast path: when the server runs
   * it (`AIRP_WRITER_FAST_PATH=on`, the default, or `shadow`), `false` keeps this save on the agent
   * writer only. Absent = follow the server.
   */
  writerFastPath: z.boolean().optional(),
}).strict();
export type WorldSettings = z.infer<typeof WorldSettingsSchema>;

/**
 * A PARTIAL update to the stored settings.
 *
 * `POST /api/world-settings` is a patch, not a whole-object overwrite: the body
 * carries only the fields the caller means to change, and they are merged over
 * what is already on disk. Without this, the endpoint's correctness would rest
 * on the coincidence that `WorldSettings` has exactly one field — the moment a
 * second field is added, any caller that posts a one-field body would silently
 * reset the other (`the design notes`).
 *
 * Strict (inherited from `WorldSettingsSchema`), so an unknown key is rejected
 * rather than silently dropped; `.partial()`, so a one-field body stays valid.
 */
export const WorldSettingsPatchSchema = WorldSettingsSchema.partial();
export type WorldSettingsPatch = z.infer<typeof WorldSettingsPatchSchema>;

export const DEFAULT_WORLD_SETTINGS: WorldSettings = { autoWrite: 'scenes-and-choices' };

/** True when a chat's summary may start a quiet writer beat (absent = on). */
export function chatBeatsEnabled(settings: { chatBeats?: boolean }): boolean {
  return settings.chatBeats !== false;
}

/** The character-tick mode this save plays with (absent = standard). */
export function characterTickMode(settings: { characterTick?: 'off' | 'easy' | 'standard' }): 'off' | 'easy' | 'standard' {
  return settings.characterTick ?? 'standard';
}

/** True when the people may write their own words (character tick v2; absent = on). */
export function characterVoicesOn(settings: { characterVoices?: boolean }): boolean {
  return settings.characterVoices !== false;
}

/** True when walking into an unwritten scene should start the I1 initialiser. */
export function startsSceneInit(autoWrite: AutoWrite): boolean {
  return autoWrite === 'scenes' || autoWrite === 'scenes-and-choices';
}

/** True when resolving a choice should start a writer turn. */
export function startsChoiceTurn(autoWrite: AutoWrite): boolean {
  return autoWrite === 'scenes-and-choices';
}
