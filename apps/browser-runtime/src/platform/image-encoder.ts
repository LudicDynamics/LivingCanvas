// The browser runtime's image encoder: the
// in-tab server and agents call `compressImage` from @airp/shared exactly as in
// Node; there sharp does the work, here this does — installed on globalThis
// before any program runs, so every program in the Worker finds it.
//
// createImageBitmap decodes (honouring EXIF orientation), an OffscreenCanvas
// scales, convertToBlob encodes. A browser that cannot encode WebP (Safari
// hands back PNG) falls back to JPEG for an opaque picture and declines for a
// transparent one; a declined picture is stored as it came.

/** The shape of @airp/shared's `EncodeOptions` (kept structural: the Worker does not import shared). */
export interface WorkerEncodeOptions {
  width: number;
  height: number;
  maxEdge: number;
  format: 'webp' | 'png' | 'jpeg';
  quality: number;
  alphaQuality: number;
  alpha: boolean;
}

const MIME = { webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg' } as const;

export function fitInside(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const offscreenImageEncoder = {
  id: 'offscreen-canvas',
  async encode(input: Uint8Array, o: WorkerEncodeOptions): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    const g = globalThis as any;
    if (typeof g.OffscreenCanvas !== 'function' || typeof g.createImageBitmap !== 'function') return null;
    const bitmap: ImageBitmap = await g.createImageBitmap(new Blob([input as BlobPart]), { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
    try {
      const size = fitInside(bitmap.width, bitmap.height, o.maxEdge);
      const canvas = new g.OffscreenCanvas(size.width, size.height);
      const ctx = canvas.getContext('2d', { alpha: o.alpha });
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      const type = MIME[o.format];
      let blob: Blob = await canvas.convertToBlob({ type, quality: o.quality / 100 });
      if (blob.type !== type) {
        if (o.format !== 'webp' || o.alpha) return null;
        blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: Math.max(o.quality, 82) / 100 });
        if (blob.type !== 'image/jpeg') return null;
      }
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type };
    } finally {
      bitmap.close();
    }
  },
};

export function installImageEncoder(): void {
  (globalThis as any).__airpImageEncoder = offscreenImageEncoder;
}
