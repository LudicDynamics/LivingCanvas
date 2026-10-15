/**
 * The 设定 tab's music picker: its options come
 * straight from the shared catalog (`@airp/shared/music`), so the picker, the
 * writer's `set_music` and the server's check can never list different tracks.
 * Pure — the component (components/chrome/MusicPicker.tsx) only renders this.
 */
import {
  AMBIENT_CATALOG,
  AMBIENT_NONE,
  AUDIO_DEFAULT,
  MUSIC_CATALOG,
  MUSIC_SILENCE,
  ambientTrack,
  musicTrack,
  type MusicTag,
} from '@airp/shared/music';

/** English message keys for the mood tags (translated in messages.json). */
export const MUSIC_TAG_LABEL: Readonly<Record<MusicTag, string>> = {
  calm: 'Calm', tense: 'Tense', eerie: 'Eerie', melancholy: 'Melancholy', warm: 'Warm', mystery: 'Mystery',
  action: 'Action', festive: 'Festive', night: 'Night', rain: 'Rain', fantasy: 'Fantasy', folk: 'Folk', retro: 'Retro',
};

export type MusicSlot = 'theme' | 'bgm' | 'ambient';

export interface PickerOption {
  /** What is posted: a catalog id or a keyword. */
  value: string;
  /** Message key for a keyword option; null for a track (its title is not translated). */
  labelKey: string | null;
  title?: string;
  tags?: readonly MusicTag[];
  description?: string;
}

/** The options of one picker, keywords first, then the catalog in its own order. */
export function pickerOptions(slot: MusicSlot): PickerOption[] {
  if (slot === 'ambient') {
    return [
      { value: AUDIO_DEFAULT, labelKey: 'Same as the map' },
      { value: AMBIENT_NONE, labelKey: 'None' },
      ...AMBIENT_CATALOG.map((t) => ({ value: t.id, labelKey: null, title: t.id, tags: t.tags, description: t.description })),
    ];
  }
  return [
    { value: AUDIO_DEFAULT, labelKey: slot === 'theme' ? 'The world type default' : 'The world theme' },
    { value: MUSIC_SILENCE, labelKey: 'Silence' },
    ...MUSIC_CATALOG.map((t) => ({ value: t.id, labelKey: null, title: t.title, tags: t.tags, description: t.description })),
  ];
}

/**
 * A stored raw value → the option to select. A place: absent → `default`
 * (inherits). The world: absent → `silence` (no theme), the type default →
 * `default`. A value outside the catalog (a world's own file) is kept as is;
 * the component shows it as one extra "this world's own file" option.
 */
export function selectedValue(slot: MusicSlot, raw: string | null | undefined, typeDefault?: string | null): string {
  const v = (raw ?? '').trim();
  if (slot === 'theme') {
    if (!v) return MUSIC_SILENCE;
    if (typeDefault && v === typeDefault) return AUDIO_DEFAULT;
    return v;
  }
  return v || AUDIO_DEFAULT;
}

/** True when `value` is one of the listed options (else it is a world's own file). */
export function isListed(slot: MusicSlot, value: string): boolean {
  return pickerOptions(slot).some((o) => o.value === value);
}

/** The platform file a preview plays (`/api/audio`, which the static site's worker also answers), or null. */
export function previewUrl(slot: MusicSlot, value: string, typeDefault?: string | null): string | null {
  const id = value === AUDIO_DEFAULT && slot === 'theme' ? typeDefault ?? '' : value;
  const file = slot === 'ambient' ? ambientTrack(id)?.file : musicTrack(id)?.file;
  return file ? `/api/audio?path=${encodeURIComponent(file)}` : null;
}
