import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStill } from '../../lib/motion.js';
import { mediaReadiness } from '../../lib/media-readiness.js';
/**
 * Shared character media projection for dialogue and Nook. It owns the single
 * video/image fallback state machine; callers only provide already-resolved
 * asset URLs and their presentation fallback.
 */
export interface CharacterMediaProps {
  video?: string;
  poster?: string;
  enabled: boolean;
  name: string;
  className?: string;
  fallback?: ReactNode;
  onPosterError?: () => void;
}

export function CharacterMedia({
  video,
  poster,
  enabled,
  name,
  className,
  fallback = null,
  onPosterError,
}: CharacterMediaProps) {
  const still = useStill();
  const ref = useRef<HTMLVideoElement>(null);
  const sourceRef = useRef<string | undefined>(video);
  const readinessEpoch = useRef(0);
  const [failedVideo, setFailedVideo] = useState(false);
  const [failedPoster, setFailedPoster] = useState(false);
  const [, setReadinessVersion] = useState(0);
  sourceRef.current = video;

  useEffect(() => {
    setFailedVideo(false);
    setFailedPoster(false);
  }, [video, poster]);

  const playing = enabled && !still && !!video && !failedVideo;
  const mediaKey = playing && video ? video : poster;
  const mediaState = mediaKey
    ? mediaReadiness.snapshot('portrait', mediaKey)
    : { state: 'unrequested' as const };

  useEffect(() => {
    if (!mediaKey) return;
    const epoch = ++readinessEpoch.current;
    let disposed = false;
    void mediaReadiness.request('portrait', mediaKey, epoch).then(() => {
      if (!disposed) setReadinessVersion((version) => version + 1);
    });
    return () => {
      disposed = true;
      mediaReadiness.cancel('portrait', mediaKey, epoch);
    };
  }, [mediaKey]);
  useEffect(() => {
    const element = ref.current;
    if (!element || !playing || !video) return;
    let visible = true;
    let disposed = false;
    const sync = () => {
      if (disposed || document.hidden || !visible || mediaState.state !== 'ready') element.pause();
      else void element.play().catch(() => {
        // Autoplay policy is not an asset failure; keep the visible still frame.
      });
    };
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
        visible = entries[0]?.isIntersecting ?? false;
        sync();
      })
      : null;
    observer?.observe(element);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      disposed = true;
      observer?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      element.pause();
    };
  }, [playing, video, mediaState.state]);

  const markReady = (asset: string) => {
    if (mediaKey !== asset || (asset === video && sourceRef.current !== asset)) return;
    mediaReadiness.markReady('portrait', asset, readinessEpoch.current);
    setReadinessVersion((version) => version + 1);
  };
  const markVideoFailed = (asset: string) => {
    if (mediaKey !== asset || sourceRef.current !== asset) return;
    mediaReadiness.markFailed('portrait', asset, readinessEpoch.current, 'media-error');
    setReadinessVersion((version) => version + 1);
    setFailedVideo(true);
  };

  if (playing) {
    return (
      <video
        ref={ref}
        key={video}
        className={className}
        src={video}
        poster={poster}
        aria-label={name}
        data-media-state={mediaState.state === 'ready' ? 'ready' : mediaState.state === 'failed' ? 'failed' : 'loading'}
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={() => markReady(video!)}
        onCanPlay={() => markReady(video!)}
        onError={() => markVideoFailed(video!)}
      />
    );
  }

  if (poster && !failedPoster) {
    return (
      <img
        className={className}
        src={poster}
        alt={name}
        data-media-state={mediaState.state === 'failed' ? 'failed' : mediaState.state === 'ready' ? 'static' : 'loading'}
        onLoad={() => markReady(poster)}
        onError={() => {
          if (mediaKey === poster) {
            mediaReadiness.markFailed('portrait', poster, readinessEpoch.current, 'media-error');
            setReadinessVersion((version) => version + 1);
          }
          setFailedPoster(true);
          onPosterError?.();
        }}
      />
    );
  }

  return <>{fallback}</>;
}
