/**
 * 设定 → 音乐: the world theme, and the current place's
 * own music and ambient bed, picked from the shared catalog with a preview.
 * A change saves at once through `POST /api/workshop/music` — the writer's own
 * `set_music` action — so the page crossfades as when the writer changes it.
 * The preview plays at the music volume and stays silent while sound is muted.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { airpGateway, type WorkshopMusicState } from '../../lib/airp-gateway.js';
import { getChannelVolume, isMuted } from '../../lib/audio.js';
import { useLocale } from '../../lib/i18n.js';
import { MUSIC_TAG_LABEL, isListed, pickerOptions, previewUrl, selectedValue, type MusicSlot } from '../../lib/music-picker.js';

interface Props {
  layer: string;
  layerName: string;
}

export function MusicPicker({ layer, layerName }: Props) {
  const { t } = useLocale();
  const [state, setState] = useState<WorkshopMusicState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    try { setState(await airpGateway.workshopMusic(layer)); } catch { setState(null); }
  }, [layer]);
  useEffect(() => { void load(); }, [load]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  }, []);
  useEffect(() => stop, [stop, layer]);

  if (!state) return null;
  const typeDefault = state.world.typeDefault;
  const values: Record<MusicSlot, string> = {
    theme: selectedValue('theme', state.world.theme, typeDefault),
    bgm: selectedValue('bgm', state.place.bgm),
    ambient: selectedValue('ambient', state.place.ambient),
  };

  const save = async (slot: MusicSlot, value: string) => {
    stop();
    setBusy(true);
    setMessage(null);
    try {
      if (slot === 'theme') await airpGateway.saveWorkshopMusic('world', value, null);
      else if (slot === 'bgm') await airpGateway.saveWorkshopMusic(state.place.layer, value, null);
      else await airpGateway.saveWorkshopMusic(state.place.layer, null, value);
      await load();
      setMessage(t('Saved.'));
    } catch (error) {
      const payload = (error as { payload?: { error?: unknown } } | null)?.payload;
      setMessage(typeof payload?.error === 'string' ? payload.error : t('That did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const preview = (slot: MusicSlot) => {
    const key = `${slot}:${values[slot]}`;
    if (playing === key) { stop(); return; }
    stop();
    const url = previewUrl(slot, values[slot], typeDefault);
    if (!url || isMuted()) return;
    const el = new Audio(url);
    el.volume = Math.max(0, Math.min(1, getChannelVolume('music')));
    el.onended = () => setPlaying((cur) => (cur === key ? null : cur));
    audioRef.current = el;
    setPlaying(key);
    void el.play().catch(() => setPlaying(null));
  };

  const row = (slot: MusicSlot, label: string) => {
    const options = pickerOptions(slot).filter((o) => !(slot === 'theme' && o.value === 'default' && !typeDefault));
    const value = values[slot];
    const canPreview = previewUrl(slot, value, typeDefault) !== null;
    const muted = isMuted();
    return (
      <div className="workshop-music__row" data-testid={`music-${slot}`}>
        <label>
          <span>{label}</span>
          <select value={value} disabled={busy || (slot !== 'theme' && !state.place.exists)} onChange={(e) => void save(slot, e.target.value)}>
            {!isListed(slot, value) && <option value={value}>{t('This world’s own file')} ({value})</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value} title={o.description}>
                {o.labelKey ? t(o.labelKey) : `${o.title} · ${(o.tags ?? []).map((tag) => t(MUSIC_TAG_LABEL[tag])).join(', ')}`}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="workshop-music__play"
          disabled={!canPreview || muted}
          title={muted ? t('Sound is muted') : undefined}
          aria-pressed={playing === `${slot}:${value}`}
          onClick={() => preview(slot)}
        >
          {playing === `${slot}:${value}` ? t('Stop') : t('Preview')}
        </button>
      </div>
    );
  };

  return (
    <section className="workshop-art__section workshop-music" aria-label={t('Music')}>
      <h3>{t('Music')}</h3>
      <p className="workshop-art__when">{t('A place with its own music rests the world theme while the player is there.')}</p>
      {row('theme', t('World theme'))}
      {row('bgm', `${t('This place')} · ${layerName}`)}
      {row('ambient', t('Ambient sound'))}
      {message && <p className="workshop-art__message" role="status">{message}</p>}
    </section>
  );
}
