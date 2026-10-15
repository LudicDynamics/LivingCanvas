/**
 * Scene tone — is the backdrop dark or light? Chalk sits straight on the
 * backdrop, so its frame and ink must flip with it
 *
 *
 *
 * Priority: an explicit README `bgStyle.tone` of `dark` / `light` wins; the
 * server's default (`warm`) means "not declared", and the backdrop image is
 * sampled once (cached by URL) to decide. No image → light.
 */
import { useEffect, useState } from 'react';

export type SceneTone = 'dark' | 'light';

/** Mean relative luminance below this reads as a dark scene. */
export const DARK_LUMINANCE = 0.42;
const SAMPLE = 24;

const cache = new Map<string, Promise<SceneTone>>();

/** Pure: classify a declared tone, or null when the image must decide. */
export function declaredTone(tone: string | undefined): SceneTone | null {
  return tone === 'dark' ? 'dark' : tone === 'light' ? 'light' : null;
}

/** Pure: mean relative luminance (0–1) of RGBA pixel data → tone. */
export function toneOfPixels(data: ArrayLike<number>, threshold = DARK_LUMINANCE): SceneTone {
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 2 < data.length; i += 4) {
    sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    count += 1;
  }
  return count > 0 && sum / count < threshold ? 'dark' : 'light';
}

function sampleImage(url: string): Promise<SceneTone> {
  return new Promise(resolve => {
    if (typeof document === 'undefined') { resolve('light'); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE;
        canvas.height = SAMPLE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) { resolve('light'); return; }
        ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
        resolve(toneOfPixels(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data));
      } catch {
        // A tainted canvas (cross-origin asset) cannot be read; keep the light default.
        resolve('light');
      }
    };
    img.onerror = () => resolve('light');
    img.src = url;
  });
}

/** Sample the backdrop once per URL; failures and missing images read as light. */
export function detectSceneTone(url: string | null): Promise<SceneTone> {
  if (!url) return Promise.resolve('light');
  let pending = cache.get(url);
  if (!pending) {
    pending = sampleImage(url);
    cache.set(url, pending);
  }
  return pending;
}

/**
 * The tone the Chalk CSS should paint for: declared beats sampled, and the
 * sampled answer only lands if the backdrop is still the same one.
 */
export function useSceneTone(declared: string | undefined, imageUrl: string | null): SceneTone {
  const fixed = declaredTone(declared);
  const [sampled, setSampled] = useState<SceneTone>('light');
  useEffect(() => {
    if (fixed) return;
    let live = true;
    void detectSceneTone(imageUrl).then(tone => { if (live) setSampled(tone); });
    return () => { live = false; };
  }, [fixed, imageUrl]);
  return fixed ?? sampled;
}
