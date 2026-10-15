/**
 * The music catalog: every shippable platform track a
 * world may name, with mood tags and a one-line description the WRITER reads
 * when it picks music (`set_music`), the workshop's music picker lists, and
 * the tests hold against `assets/audio`.
 *
 * An id is the bare pool key the server already resolves (apps/server/src/
 * routes/world.ts AUDIO_POOL): music ids are found under `bgm/{id}.mp3` or
 * `themes/{id}.mp3`, ambient ids under `ambient/{id}.mp3` or
 * `ambient/pool/{id}.mp3`. Where a value goes:
 *
 *   - world.json `audio.theme` — the world-wide theme (one music id);
 *   - a layer README frontmatter `bgm:` — a place's own music; while a place
 *     has its own track, the world theme rests (the two never play together);
 *   - a layer README frontmatter `ambient:` — the place's sound bed.
 *
 * Keywords instead of an id: `silence` (declared quiet: for `bgm:` the theme
 * rests too; for world.json no theme), `none` (no ambient bed), `default`
 * (remove the declaration: a place inherits the map README / the world theme,
 * the world goes back to its type's default theme).
 *
 * Listen-free: tags were derived from file names, assets/audio/CREDITS.md
 * titles and the design notes — `guess: true` marks the ones taken from a title alone
 * (the team: retag after listening). Audition folders (`candidates`, `choices`,
 * `choices2`) and `licensed/` (the launcher's own music) are not in the
 * catalog. Zero dependencies (like rules/themes.ts): the web bundle imports it
 * through `@airp/shared/music`.
 */

export const MUSIC_TAGS = [
  'calm', 'tense', 'eerie', 'melancholy', 'warm', 'mystery', 'action', 'festive', 'night', 'rain',
  'fantasy', 'folk', 'retro',
] as const;
export type MusicTag = (typeof MUSIC_TAGS)[number];

export interface MusicTrack {
  /** Bare pool key, e.g. `calm`, `guixiang`, `canvas-mistport`. */
  id: string;
  /** Platform file under `assets/audio/`. */
  file: string;
  /** Short title for the picker (the original track title). */
  title: string;
  tags: readonly MusicTag[];
  /** One line, English, for the writer and the picker's tooltip. */
  description: string;
  /** Tags derived from the title alone (not listened to). */
  guess?: true;
  /** Seconds, from CREDITS (approximate). */
  seconds?: number;
  /**
   * A redistributable track to play when this file is not installed. The
   * MaouDamashii themes may not be redistributed, so the open-source copy
   * ships without them and every `canvas-*` key falls back to a CC0 / CC-BY one.
   */
  fallback?: string;
}

export const MUSIC_CATALOG: readonly MusicTrack[] = [
  // ——— bgm/ — three mood beds (CC0, Freesound) ———
  { id: 'calm', file: 'bgm/calm.mp3', title: 'Piano Song Loop #4 Childhood', tags: ['calm', 'warm'], seconds: 37,
    description: 'Short gentle piano loop; safe, homely, a quiet moment between events.' },
  { id: 'tense', file: 'bgm/tense.mp3', title: 'Dark Atmospheric Drone', tags: ['tense', 'eerie', 'mystery', 'night'], seconds: 158,
    description: 'Slow dark drone with no melody; dread, something is wrong, exploring the unknown.' },
  { id: 'crisis', file: 'bgm/crisis.mp3', title: 'Fight Music Synth Tense Loop', tags: ['action', 'tense'], seconds: 97,
    description: 'Driving synth fight loop; chase, combat, a countdown about to run out.' },
  // ——— themes/ — world themes (CC0 / CC-BY, Freesound and OpenGameArt) ———
  { id: 'wuwu', file: 'themes/wuwu.mp3', title: 'Pirate Tavern', tags: ['festive', 'warm', 'folk'], seconds: 61,
    description: 'Lively tavern tune; harbour town, inn, merry company, adventure setting out.' },
  { id: 'whitechapel', file: 'themes/whitechapel.mp3', title: 'Detective Hawkeye', tags: ['mystery', 'tense', 'night'], seconds: 43,
    description: 'Sly detective theme; investigation, foggy streets, a case to crack.' },
  { id: 'divergence', file: 'themes/divergence.mp3', title: 'Retro (generative)', tags: ['mystery', 'calm', 'retro'], seconds: 120,
    description: 'Generative retro synth; thoughtful, slightly uncanny, science or a puzzle unfolding.' },
  { id: 'firstsnow', file: 'themes/firstsnow.mp3', title: 'Awesome Emotional Piano', tags: ['melancholy', 'warm', 'calm'], seconds: 64,
    description: 'Emotional piano; memory, longing, a tender or bittersweet scene, a goodbye.' },
  { id: 'emberglass', file: 'themes/emberglass.mp3', title: 'Mystical fantasy loop', tags: ['fantasy', 'mystery', 'calm'], seconds: 55,
    description: 'Mystical fantasy loop; magic school, enchanted places, wonder.' },
  { id: 'mandongbu', file: 'themes/mandongbu.mp3', title: 'School Day (Loop)', tags: ['warm', 'festive', 'calm'], seconds: 85,
    description: 'Bright easy-going school-day loop; daily life, club room, friends, slice of life.' },
  { id: 'guixiang', file: 'themes/guixiang.mp3', title: 'Karst Mountains + Dark Drone', tags: ['eerie', 'folk', 'mystery'], seconds: 104,
    description: 'Guzheng over a low drone; Chinese folk horror, an old village, ancestral dread.' },
  // ——— themes/canvas-* — MaouDamashii full-length themes (creator terms, attribution in CREDITS) ———
  { id: 'canvas-mistport', file: 'themes/canvas-mistport.mp3', fallback: 'calm', title: 'Piano 36', tags: ['calm', 'night', 'melancholy'], guess: true,
    description: 'Quiet night piano; a stopped train, empty streets after dark, lonely reflection.' },
  { id: 'canvas-wuwu', file: 'themes/canvas-wuwu.mp3', fallback: 'wuwu', title: 'Fantasy 13', tags: ['fantasy', 'warm'], guess: true,
    description: 'Full-length fantasy theme; a storybook town, gentle adventure.' },
  { id: 'canvas-whitechapel', file: 'themes/canvas-whitechapel.mp3', fallback: 'whitechapel', title: 'Orchestra 26', tags: ['mystery', 'tense'], guess: true,
    description: 'Orchestral theme; Victorian city, grand mystery, rising stakes.' },
  { id: 'canvas-divergence', file: 'themes/canvas-divergence.mp3', fallback: 'divergence', title: 'Healing 17', tags: ['calm', 'warm'], guess: true,
    description: 'Soft healing theme; rest, recovery, a safe haven after danger.' },
  { id: 'canvas-firstsnow', file: 'themes/canvas-firstsnow.mp3', fallback: 'firstsnow', title: 'Acoustic 54', tags: ['warm', 'calm', 'melancholy'], guess: true,
    description: 'Acoustic guitar theme; winter evening, radio, warmth with a little sadness.' },
];

export interface AmbientTrack {
  id: string;
  file: string;
  tags: readonly MusicTag[];
  description: string;
}

/** Sound beds for `ambient:` (CC0 / CC-BY, Freesound; CREDITS §3). */
export const AMBIENT_CATALOG: readonly AmbientTrack[] = [
  { id: 'rain', file: 'ambient/rain.mp3', tags: ['rain', 'calm'], description: 'Steady rain on a forest.' },
  { id: 'fireplace', file: 'ambient/fireplace.mp3', tags: ['warm', 'calm'], description: 'Crackling fireplace indoors.' },
  { id: 'cellar-drip', file: 'ambient/cellar-drip.mp3', tags: ['eerie'], description: 'Water dripping in a cellar or cave.' },
  { id: 'storm', file: 'ambient/pool/storm.mp3', tags: ['rain', 'tense'], description: 'Thunderstorm, heavy rain, thunderclaps.' },
  { id: 'snow-wind', file: 'ambient/pool/snow-wind.mp3', tags: ['night', 'melancholy'], description: 'Winter snowstorm wind.' },
  { id: 'harbor-waves', file: 'ambient/pool/harbor-waves.mp3', tags: ['calm'], description: 'Sea waves at a harbour.' },
  { id: 'library', file: 'ambient/pool/library.mp3', tags: ['calm'], description: 'Hush of a large library.' },
  { id: 'city-night', file: 'ambient/pool/city-night.mp3', tags: ['night'], description: 'City street at night, distant traffic.' },
  { id: 'office-night', file: 'ambient/pool/office-night.mp3', tags: ['night', 'calm'], description: 'Empty office late at night.' },
  { id: 'cave-drip', file: 'ambient/pool/cave-drip.mp3', tags: ['eerie', 'tense'], description: 'Cave dripping, horror variant.' },
  { id: 'tavern-chatter', file: 'ambient/pool/tavern-chatter.mp3', tags: ['festive', 'warm'], description: 'Low tavern chatter.' },
  { id: 'cafe-murmur', file: 'ambient/pool/cafe-murmur.mp3', tags: ['warm'], description: 'Cafe voices, cups and plates.' },
  { id: 'bell-church', file: 'ambient/pool/bell-church.mp3', tags: ['melancholy'], description: 'Distant church bells.' },
  { id: 'forge', file: 'ambient/pool/forge.mp3', tags: ['warm'], description: 'Forge bellows and burning coal.' },
];

/** Keywords accepted in place of an id. */
export const MUSIC_SILENCE = 'silence';
export const AMBIENT_NONE = 'none';
export const AUDIO_DEFAULT = 'default';

const MUSIC_BY_ID = new Map(MUSIC_CATALOG.map((t) => [t.id, t]));
const AMBIENT_BY_ID = new Map(AMBIENT_CATALOG.map((t) => [t.id, t]));

export function musicTrack(id: string): MusicTrack | undefined {
  return MUSIC_BY_ID.get(id);
}
export function ambientTrack(id: string): AmbientTrack | undefined {
  return AMBIENT_BY_ID.get(id);
}
export function isMusicId(id: unknown): id is string {
  return typeof id === 'string' && MUSIC_BY_ID.has(id);
}
export function isAmbientId(id: unknown): id is string {
  return typeof id === 'string' && AMBIENT_BY_ID.has(id);
}

/** True for a declared-quiet value (`silence` / `none`), which the server resolves to null without probing. */
export function isQuietAudioValue(v: unknown): boolean {
  return typeof v === 'string' && (v.trim() === MUSIC_SILENCE || v.trim() === AMBIENT_NONE);
}

/** Compact lines for the writer: `id (tag, tag)`, one entry per item, comma-joined. */
export function musicCatalogSummary(): string {
  const music = MUSIC_CATALOG.map((t) => `${t.id} (${t.tags.join(', ')})`).join('; ');
  const ambient = AMBIENT_CATALOG.map((t) => `${t.id} (${t.tags.join(', ')})`).join('; ');
  return `Music: ${music}.\nAmbient: ${ambient}.`;
}

/** One line per entry with the description: what `set_music`'s description lists. */
export function musicCatalogLines(): string[] {
  return [
    ...MUSIC_CATALOG.map((t) => `${t.id} [${t.tags.join(', ')}] — ${t.description}`),
    ...AMBIENT_CATALOG.map((t) => `ambient ${t.id} [${t.tags.join(', ')}] — ${t.description}`),
  ];
}

/** The canvas UI sounds (`foley/canvas/se-*.mp3`, MaouDamashii) → the CC0 foley of the same role. */
const CANVAS_SE_FALLBACK: Record<string, string> = {
  card: 'paper-slide', get: 'bag-pack', dice: 'dice-roll', success: 'crit-chime',
  write: 'pen-scratch', door: 'gate-open', paper: 'page-turn', bell: 'crit-chime',
};

/**
 * The redistributable stand-in for a platform audio file that may be absent
 * (the open-source copy ships without MaouDamashii, Suno and `licensed/`
 * files), or null. Paths are relative to `assets/audio/`. Pure.
 */
export function platformAudioFallback(rel: string): string | null {
  const track = MUSIC_CATALOG.find((t) => t.file === rel);
  if (track?.fallback) return musicTrack(track.fallback)?.file ?? null;
  const se = rel.match(/^foley\/canvas\/se-([a-z]+)\.mp3$/)?.[1];
  if (se && CANVAS_SE_FALLBACK[se]) return `foley/${CANVAS_SE_FALLBACK[se]}.mp3`;
  // the launcher's own theme (a local Suno track) → the calm piano bed
  if (rel === 'licensed/launcher.mp3') return 'bgm/calm.mp3';
  return null;
}
