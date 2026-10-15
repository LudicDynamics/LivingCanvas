import { CharacterMedia } from '../media/CharacterMedia.js';

/** One visible conversation portrait, never a video decoder per small avatar. */
export function MotionPortrait({ video, poster, enabled, name, onPosterError }: {
  video?: string; poster?: string; enabled: boolean; name: string; onPosterError: () => void;
}) {
  return (
    <CharacterMedia
      video={video}
      poster={poster}
      enabled={enabled}
      name={name}
      onPosterError={onPosterError}
    />
  );
}
