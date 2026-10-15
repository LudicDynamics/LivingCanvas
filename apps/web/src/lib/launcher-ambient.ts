/**
 * The launcher's glow behind the wall, and its cover thumbnails, made ONCE as
 * small static bitmaps.
 *
 * The glow used to be every cover side by side under `filter: blur(70px)
 * saturate(1.25) brightness(.34)` on a box 130% of the viewport: a 70px blur
 * over ~2 million device pixels, re-run whenever the compositor redrew that
 * surface. Here the same picture is drawn into a canvas ~128px wide, blurred
 * and graded in JS (three box-blur passes ≈ a Gaussian), and shown as a plain
 * <img> the browser just scales up. A blur that wide has no detail a 128px
 * bitmap cannot hold, so the look is the same and nothing is filtered per frame.
 *
 * The pixel helpers are pure (tested in apps/web/test/launcher-ambient.test.mjs);
 * the builders touch the DOM only when called and cache by input, so remounts
 * and re-renders reuse the same object URL.
 */

/** The look the CSS filter had: blur radius (CSS px, = Gaussian σ), then saturate, then brightness. */
export const AMBIENT_LOOK = { radius: 70, reducedRadius: 24, saturate: 1.25, brightness: 0.34 } as const;
/** Width of the glow bitmap in pixels; its height follows the box's aspect. */
export const AMBIENT_BITMAP_WIDTH = 128;
/** The ambient box overhangs the viewport by 15% on every side (world-launcher.css `inset: -15%`). */
export const AMBIENT_OVERHANG = 0.15;
/** The launcher's own background, which shows wherever there is no cover. */
const BACKGROUND: readonly [number, number, number] = [4, 5, 12];

/** Box-blur radius that, applied `passes` times, approximates a Gaussian of standard deviation `sigma`. */
export function boxRadiusForSigma(sigma: number, passes = 3): number {
  if (!(sigma > 0)) return 0;
  return Math.max(0, Math.round((Math.sqrt((12 * sigma * sigma) / passes + 1) - 1) / 2));
}

/**
 * In-place separable box blur of RGBA pixels, `passes` times. Samples beyond
 * the edge read `edge` (the background the original blur faded into).
 */
export function boxBlurRGBA(data: Uint8ClampedArray, width: number, height: number, radius: number, passes = 3, edge: readonly [number, number, number] = BACKGROUND): void {
  if (radius < 1 || width < 1 || height < 1) return;
  const size = 2 * radius + 1;
  const line = new Float32Array(Math.max(width, height) * 3);
  for (let pass = 0; pass < passes; pass++) {
    for (const horizontal of [true, false]) {
      const length = horizontal ? width : height;
      const lines = horizontal ? height : width;
      for (let l = 0; l < lines; l++) {
        const at = (i: number) => (horizontal ? (l * width + i) : (i * width + l)) * 4;
        for (let i = 0; i < length; i++) {
          const p = at(i);
          line[i * 3] = data[p];
          line[i * 3 + 1] = data[p + 1];
          line[i * 3 + 2] = data[p + 2];
        }
        const sample = (i: number, c: number) => (i < 0 || i >= length ? edge[c] : line[i * 3 + c]);
        let r = 0, g = 0, b = 0;
        for (let i = -radius; i <= radius; i++) { r += sample(i, 0); g += sample(i, 1); b += sample(i, 2); }
        for (let i = 0; i < length; i++) {
          const p = at(i);
          data[p] = r / size;
          data[p + 1] = g / size;
          data[p + 2] = b / size;
          data[p + 3] = 255;
          r += sample(i + radius + 1, 0) - sample(i - radius, 0);
          g += sample(i + radius + 1, 1) - sample(i - radius, 1);
          b += sample(i + radius + 1, 2) - sample(i - radius, 2);
        }
      }
    }
  }
}

/** CSS `saturate(s) brightness(k)` on RGBA pixels, in place (Filter Effects matrices, sRGB values). */
export function gradeRGBA(data: Uint8ClampedArray, saturate: number, brightness: number): void {
  const s = saturate;
  const m = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
  for (let p = 0; p < data.length; p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    // Clamp after saturate, as the filter chain does between functions.
    data[p] = Math.min(255, Math.max(0, m[0] * r + m[1] * g + m[2] * b)) * brightness;
    data[p + 1] = Math.min(255, Math.max(0, m[3] * r + m[4] * g + m[5] * b)) * brightness;
    data[p + 2] = Math.min(255, Math.max(0, m[6] * r + m[7] * g + m[8] * b)) * brightness;
  }
}

/** Source rectangle of a `background-size: cover; background-position: center` fit. */
export function coverCrop(imageWidth: number, imageHeight: number, boxWidth: number, boxHeight: number): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
  const sw = boxWidth / scale;
  const sh = boxHeight / scale;
  return { sx: (imageWidth - sw) / 2, sy: (imageHeight - sh) / 2, sw, sh };
}

/** Size of the glow bitmap and the blur σ in bitmap pixels, for a viewport and a CSS blur radius. */
export function ambientBitmapSize(viewportWidth: number, viewportHeight: number, radius: number): { width: number; height: number; sigma: number } {
  const boxWidth = Math.max(1, viewportWidth) * (1 + 2 * AMBIENT_OVERHANG);
  const boxHeight = Math.max(1, viewportHeight) * (1 + 2 * AMBIENT_OVERHANG);
  const width = AMBIENT_BITMAP_WIDTH;
  const height = Math.max(8, Math.min(512, Math.round((width * boxHeight) / boxWidth)));
  return { width, height, sigma: (radius * width) / boxWidth };
}

const loaded = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(url: string): Promise<HTMLImageElement | null> {
  let pending = loaded.get(url);
  if (!pending) {
    pending = new Promise(resolve => {
      const image = new Image();
      image.decoding = 'async';
      // decode() keeps the (possibly multi-MB) decode off the main thread.
      image.onload = () => { image.decode().then(() => resolve(image), () => resolve(image)); };
      image.onerror = () => resolve(null);
      image.src = url;
    });
    loaded.set(url, pending);
  }
  return pending;
}

function canvasToUrl(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<string | null> {
  return new Promise(resolve => {
    try {
      canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null), type, quality);
    } catch {
      resolve(null); // tainted canvas (a cross-origin cover without CORS): no glow, the gradient stays
    }
  });
}

const ambients = new Map<string, Promise<string | null>>();

/**
 * Object URL of the pre-blurred glow for these covers laid out in `columns`
 * columns (the old grid), or null when it cannot be made (no canvas, a
 * tainted cover). Cached per input: the viewport is bucketed so a resize of a
 * few pixels reuses the same bitmap.
 */
export function ambientBackdropUrl(covers: readonly string[], columns: number, viewportWidth: number, viewportHeight: number, radius: number): Promise<string | null> {
  if (!covers.length || typeof document === 'undefined') return Promise.resolve(null);
  const { width, height, sigma } = ambientBitmapSize(viewportWidth, viewportHeight, radius);
  const key = `${covers.join('|')}#${columns}#${height}#${Math.round(sigma * 4)}`;
  let pending = ambients.get(key);
  if (!pending) {
    pending = (async () => {
      const images = await Promise.all(covers.map(loadImage));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.fillStyle = `rgb(${BACKGROUND.join(',')})`;
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      const cols = Math.max(1, columns);
      const rows = Math.ceil(covers.length / cols);
      const cellW = width / cols;
      const cellH = height / rows;
      images.forEach((image, index) => {
        if (!image || !image.naturalWidth) return;
        const x = (index % cols) * cellW;
        const y = Math.floor(index / cols) * cellH;
        const { sx, sy, sw, sh } = coverCrop(image.naturalWidth, image.naturalHeight, cellW, cellH);
        context.drawImage(image, sx, sy, sw, sh, x, y, cellW, cellH);
      });
      let pixels: ImageData;
      try {
        pixels = context.getImageData(0, 0, width, height);
      } catch {
        return null;
      }
      boxBlurRGBA(pixels.data, width, height, boxRadiusForSigma(sigma));
      gradeRGBA(pixels.data, AMBIENT_LOOK.saturate, AMBIENT_LOOK.brightness);
      context.putImageData(pixels, 0, 0);
      return canvasToUrl(canvas, 'image/png');
    })().catch(() => null);
    ambients.set(key, pending);
  }
  return pending;
}

/** Widest a cover is ever drawn on a brick, in CSS px (brickGeometry caps bricks at 520). */
export const COVER_THUMB_CSS_WIDTH = 520;

/** Pixel width to downscale a cover to for a brick `cssWidth` wide at `dpr`, or null when the original is already small enough. */
export function coverThumbWidth(naturalWidth: number, cssWidth: number, dpr: number): number | null {
  const target = Math.ceil(Math.min(COVER_THUMB_CSS_WIDTH, cssWidth) * Math.min(2, Math.max(1, dpr)));
  return naturalWidth > target * 1.25 ? target : null;
}

const thumbs = new Map<string, Promise<string>>();

/**
 * A copy of the cover downscaled once to what a brick can show (≤ 520 CSS px
 * at ≤ 2x), as an object URL; the original URL when it is already small, or
 * when it cannot be read back. Every brick of the same world shares it, so the
 * wall rasters a ~1000px bitmap instead of re-sampling a full-size original
 * (moonlit-contract's cover is a 2.2 MB PNG).
 */
export function coverThumbUrl(url: string, cssWidth: number, dpr: number): Promise<string> {
  if (typeof document === 'undefined') return Promise.resolve(url);
  const bucket = coverThumbWidth(Number.MAX_SAFE_INTEGER, cssWidth, dpr) ?? 0;
  const key = `${url}#${bucket}`;
  let pending = thumbs.get(key);
  if (!pending) {
    pending = (async () => {
      const image = await loadImage(url);
      if (!image || !image.naturalWidth) return url;
      const width = coverThumbWidth(image.naturalWidth, cssWidth, dpr);
      if (!width) return url;
      const height = Math.max(1, Math.round((image.naturalHeight * width) / image.naturalWidth));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return url;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, width, height);
      return (await canvasToUrl(canvas, 'image/webp', 0.86)) ?? url;
    })().catch(() => url);
    thumbs.set(key, pending);
  }
  return pending;
}
