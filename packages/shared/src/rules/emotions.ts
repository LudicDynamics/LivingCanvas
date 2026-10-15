/**
 * The six emotion differentials.
 *
 * A character's face has exactly these six moods. The character agent emits a
 * `[emo: <tag>]` tag at the head of a spoken line; the modal switches the
 * portrait to `<id>/<tag>.webp`. The enum MUST stay in lockstep with the tag
 * parser (`apps/web/src/components/overlay/dialogue-pages.ts`) and the TTS
 * stinger palette — but the *list* lives here so the server route and the web
 * client read one source instead of two hand-copied literals.
 *
 * Zero dependencies on purpose (same discipline as `rules/characters.ts` and
 * `rules/voices.ts`): the server route, the web bundle and the asset gate all
 * import this without pulling in zod, React or the world store.
 */

/** Order is the canonical render order; index is not meaningful. */
export const EMOTIONS = ['normal', 'smile', 'shock', 'sad', 'angry', 'thinking'] as const;

export type Emotion = (typeof EMOTIONS)[number];

/** A per-emotion map of world-relative portrait paths. */
export type EmotionPortraits = Record<Emotion, string>;

/** Narrowing guard for `[emo: tag]` payloads arriving from the model. */
export function isEmotion(value: unknown): value is Emotion {
  return typeof value === 'string' && (EMOTIONS as readonly string[]).includes(value);
}

/**
 * The six world-relative portrait paths for a character, in `EMOTIONS` order:
 * `assets/characters/<id>/{normal,smile,shock,sad,angry,thinking}.webp`.
 *
 * This names the ONE publish convention that both the
 * server probe and the web client depend on — callers never assemble the path
 * themselves, so a convention change lands in a single place.
 */
export function emotionPortraitsOf(characterId: string): EmotionPortraits {
  const dir = `assets/characters/${characterId}`;
  return Object.fromEntries(EMOTIONS.map((e) => [e, `${dir}/${e}.webp`])) as EmotionPortraits;
}
