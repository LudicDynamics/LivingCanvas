/**
 * The scenes' animated pictures, inside the bag.
 *
 * Not a HUD: it renders only inside the opened belongings drawer, after the
 * items, and only once this save has entered a scene with an animated picture.
 * Each tile plays its picture full-size (`SCENE_REPLAY_DOM`, shown by
 * `MilestoneStage`). Scenes not yet entered are simply absent — no locked
 * tiles, no counts.
 */
import React from 'react';
import { useLocale } from '../../lib/i18n.js';
import { SCENE_REPLAY_DOM, type MomentScene } from '../../lib/milestones.js';
import './scene-reel.css';

export interface SceneReelProps {
  scenes: MomentScene[];
  /** World-relative asset → URL (App's `assetUrl`). */
  resolveAsset: (path: string, kind: 'image' | 'video') => string | null;
}

export function SceneReel({ scenes, resolveAsset }: SceneReelProps): React.ReactElement | null {
  const { t } = useLocale();
  if (scenes.length === 0) return null;
  return (
    <section className="scene-reel" aria-label={t('Scenes')} data-testid="scene-reel">
      <div className="inventory-heading"><span>{t('SCENES')}</span></div>
      <ul className="scene-reel__list">
        {scenes.map((s) => {
          const poster = s.poster ? resolveAsset(s.poster, 'image') : null;
          return (
            <li key={s.video ?? s.layer}>
              <button
                type="button"
                className="scene-reel__tile"
                title={s.name}
                aria-label={t('Play {title}', { title: s.name })}
                onClick={() => window.dispatchEvent(new CustomEvent(SCENE_REPLAY_DOM, { detail: { scene: s } }))}
              >
                {poster ? <img src={poster} alt="" loading="lazy" draggable={false} /> : <span aria-hidden="true">▶</span>}
                <span className="scene-reel__name">{s.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
