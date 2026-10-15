import React, { useEffect, useRef, useState } from 'react';
import { subscribeParallax } from '../../lib/parallax.js';
import { materialSkinOf } from '@airp/shared/forms';
import { airpGateway } from '../../lib/airp-gateway.js';
import { useStill } from '../../lib/motion.js';
import { mediaReadiness } from '../../lib/media-readiness.js';
/** The layer backdrop payload from `GET /api/layer` (see LayerState.bg). */
export interface SceneBackdropBg {
  /** World-relative asset path (`assets/scenes/<layer>/<file>.png`), or null. */
  src: string | null;
  /** Optional animated companion; src remains the static fallback. */
  video?: string;
  /** Material tone — a CSS hook (`data-tone`), NOT an audio selector. */
  tone: string;
  /** Material skin key — `parchment` | `warm` | `stub` | `kraft`. */
  grain: string;
}

export interface SceneBackdropProps {
  bg: SceneBackdropBg;
  effectsEnabled?: boolean;
}

/**
 * The layer's "paper" fills the viewport: a material skin (always present) →
 * optional painted scene image or video → warm-ink edge vignette. It sits behind the
 * camera viewport (`absolute inset 0`, `z-0`, `pointer-events: none`), so it
 * never intercepts canvas clicks.
 *
 * Parallax depth: 0.25x slow drift with camera & pointer.
 * Video support: if src ends with .mp4 or .webm, renders an autoplaying loop video.
 */
export const SceneBackdrop: React.FC<SceneBackdropProps> = ({ bg, effectsEnabled = false }) => {
  const still = useStill();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [failedVideo, setFailedVideo] = useState<string | null>(null);
  const [, setReadinessVersion] = useState(0);
  const readinessEpoch = useRef(0);

  const bgIsVideo = !!bg.src && /\.(mp4|webm)$/i.test(bg.src);
  const motionUrl = bg.video ? airpGateway.assetUrl(bg.video, undefined, 'video') : null;
  const directVideoUrl = bgIsVideo
    ? airpGateway.assetUrl(bg.src!, undefined, 'video')
    : null;
  const motionAllowed = effectsEnabled && !still;
  const videoSrc = motionAllowed ? motionUrl ?? directVideoUrl : null;
  // A companion `video` always uses `bg.src` as its static poster. A video
  // src without a declared poster intentionally falls back to paper.
  const posterSrc = bg.src && !bgIsVideo
    ? airpGateway.assetUrl(bg.src, undefined, 'image')
    : null;
  const isVideo = !!videoSrc && failedVideo !== videoSrc;
  const src = isVideo ? videoSrc : posterSrc;
  const sourceRef = useRef<string | null>(src);
  sourceRef.current = src;
  const readiness = src
    ? mediaReadiness.snapshot('background', src)
    : { state: 'unrequested' as const };
  const sourceFailed = isVideo ? failedVideo === src : failedSrc === src;
  const mediaState = (readiness.state === 'failed' || sourceFailed)
    ? 'failed'
    : readiness.state === 'ready'
      ? 'ready'
      : src
        ? 'loading'
        : 'paper';

  useEffect(() => {
    if (!src) return;
    const epoch = ++readinessEpoch.current;
    let disposed = false;
    void mediaReadiness.request('background', src, epoch).then(() => {
      if (!disposed && sourceRef.current === src) setReadinessVersion((version) => version + 1);
    });
    return () => {
      disposed = true;
      mediaReadiness.cancel('background', src, epoch);
    };
  }, [src]);
  // Parallax is optional decoration. Effects off and reduced motion both
  // restore the paper to its neutral position without touching the scene fact.
  useEffect(
    () =>
      subscribeParallax((p) => {
        const el = rootRef.current;
        if (!el || !motionAllowed || isVideo) return;
        el.style.transform = `translate3d(${p.x * 16}px, ${p.y * 16}px, 0) scale(1.06)`;
      }),
    [motionAllowed, isVideo]
  );
  useEffect(() => {
    const root = rootRef.current;
    if (root && (!motionAllowed || isVideo)) {
      root.style.transform = 'translate3d(0, 0, 0) scale(1.06)';
    }
    const video = videoRef.current;
    if (!video || !isVideo || !src) return;
    let disposed = false;
    const sync = () => {
      if (
        disposed ||
        !motionAllowed ||
        (typeof document !== 'undefined' && document.hidden) ||
        readiness.state !== 'ready'
      ) {
        video.pause();
        return;
      }
      void video.play().catch(() => {
        // Autoplay rejection is not an asset failure; keep the poster visible.
      });
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      disposed = true;
      video.pause();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [motionAllowed, isVideo, src, readiness.state]);

  const markReady = (asset: string): void => {
    if (sourceRef.current !== asset) return;
    mediaReadiness.markReady('background', asset, readinessEpoch.current);
    setReadinessVersion((version) => version + 1);
  };
  const markFailed = (asset: string, video: boolean): void => {
    if (sourceRef.current !== asset) return;
    mediaReadiness.markFailed('background', asset, readinessEpoch.current, 'media-error');
    setReadinessVersion((version) => version + 1);
    if (video) setFailedVideo(asset);
    else setFailedSrc(asset);
  };

  return (
    <div
      ref={rootRef}
      className={`scene-backdrop ${materialSkinOf(bg.grain)}`}
      data-tone={bg.tone}
      style={{ transform: 'translate3d(0, 0, 0) scale(1.06)', transition: 'transform var(--ux-motion-fast) var(--ux-motion-ink)' }}
    >
      {isVideo && src ? (
        <video
          key={src}
          ref={videoRef}
          className="scene-backdrop__img object-cover"
          loop
          muted
          playsInline
          preload="metadata"
          poster={posterSrc ?? undefined}
          src={src}
          onLoadedMetadata={() => markReady(src!)}
          onCanPlay={() => markReady(src!)}
          onError={() => markFailed(src!, true)}
        />
      ) : posterSrc && failedSrc !== posterSrc ? (
        <img
          key={posterSrc}
          className="scene-backdrop__img"
          src={posterSrc}
          alt=""
          onLoad={() => markReady(posterSrc)}
          onError={() => markFailed(posterSrc, false)}
        />
      ) : null}
      <div className="scene-backdrop__vignette" />
    </div>
  );
};
