import React, { useEffect, useMemo, useState } from 'react';
import { airpGateway } from '../../lib/airp-gateway.js';
import './photo.css';

export type PhotoImageState = 'missing' | 'loading' | 'loaded' | 'error';

export interface PhotoMediaProps {
  image?: string;
  alt: string;
  variant: 'card' | 'detail' | 'carried';
  session?: string;
  onStateChange?: (state: PhotoImageState) => void;
}

export interface PhotoItem {
  path: string;
  filename: string;
  frontmatter: Record<string, any> | null;
  body: string;
  kind?: string;
}

/**
 * The browser-side check intentionally only establishes a safe, world-relative
 * asset namespace. MIME, symlink and filesystem checks remain server-owned by
 * assertImageAsset and /api/asset.
 */
function isPhotoAssetPath(value: string): boolean {
  if (!value || value.includes('\\') || value.startsWith('/')) return false;
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return false;
  const isAssetRoot = segments[0] === 'assets' && segments.length > 1;
  const isGeneratedRoot = segments[0] === '.airpworld' && segments[1] === 'assets' && segments.length > 2;
  if (!isAssetRoot && !isGeneratedRoot) return false;
  return segments.every((segment, index) => !segment.startsWith('.') || (index === 0 && segment === '.airpworld'));
}

export function PhotoMedia({ image, alt, variant, session, onStateChange }: PhotoMediaProps): React.ReactElement {
  const normalizedImage = typeof image === 'string' ? image.trim() : '';
  const validPath = isPhotoAssetPath(normalizedImage);
  const sourceKey = validPath ? `${normalizedImage}\u0000${session ?? ''}` : '';
  const [state, setState] = useState<PhotoImageState>(() => validPath ? 'loading' : 'missing');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setState(validPath ? 'loading' : 'missing');
    setAttempt(0);
  }, [sourceKey, validPath]);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  const src = useMemo(
    () => validPath ? airpGateway.assetUrl(normalizedImage, session, 'image') : undefined,
    [normalizedImage, session, validPath],
  );

  const retry = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!validPath) return;
    setState('loading');
    setAttempt(value => value + 1);
  };

  return (
    <div className={`photo-media photo-media--${variant}`} data-photo-state={state}>
      {src && (state === 'loading' || state === 'loaded') && (
        <img
          key={`${src}:${attempt}`}
          className="photo-media__image"
          src={src}
          alt={alt}
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
      {state === 'loading' && (
        <p className="photo-media__status" role="status">Loading photo…</p>
      )}
      {state === 'missing' && (
        <p className="photo-media__status" role="status">No image asset is attached to this photo.</p>
      )}
      {state === 'error' && (
        <div className="photo-media__error" role="alert">
          <p>Photo image could not be loaded.</p>
          <button type="button" data-no-drag onClick={retry}>Retry image</button>
        </div>
      )}
    </div>
  );
}
