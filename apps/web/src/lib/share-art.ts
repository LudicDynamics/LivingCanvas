/**
 * The pictures a share card can use
 * A CG is kept the moment it is shown (CgReveal), the world cover when a world
 * opens (App), as a downscaled JPEG blob in this browser's IndexedDB: the card can then use the latest CG from any
 * world later, even from the launcher, and the canvas stays untainted (a blob made here is same-origin by birth).
 *
 * Nothing here leaves the browser. No IndexedDB (tests, private modes) → every call is a quiet no-op.
 *
 * The CGs every save on this computer has shown (the 个人页面's gallery: GET /api/profile/saves, each picture
 * through GET /api/profile/cg — same origin) come first: `savedCgs()`.
 */
import { withBase } from './base-path.js';
import { worldTitle } from './world-launcher.js';

/** One CG a save has shown, as the share dialog offers it (newest first). */
export interface SavedCg { id: string; worldKey: string; worldTitle: string; saveId: string; path: string; caption: string | null; at: number; src: string }
export async function savedCgs(limit = 24): Promise<SavedCg[]> {
  try {
    const res = await fetch(withBase('/api/profile/saves'), { headers: { accept: 'application/json' }, cache: 'no-store' });
    const body = (await res.json()) as { saves?: { saveId: string; manifestId: string; name: string; updatedAt: string; cgs?: { path: string; caption: string | null; at: string | null }[] }[] };
    const out: SavedCg[] = [];
    for (const sv of body.saves ?? []) {
      for (const cg of sv.cgs ?? []) {
        out.push({
          id: `save:${sv.saveId}:${cg.path}`,
          worldKey: sv.manifestId,
          worldTitle: worldTitle(sv.name || '') || sv.name,
          saveId: sv.saveId,
          path: cg.path,
          caption: cg.caption ?? null,
          at: Date.parse(cg.at ?? sv.updatedAt) || 0,
          src: withBase(`/api/profile/cg?save=${encodeURIComponent(sv.saveId)}&path=${encodeURIComponent(cg.path)}`),
        });
      }
    }
    const seen = new Set<string>();
    return out.sort((a, b) => b.at - a.at).filter((c) => { const k = `${c.worldKey}|${c.path}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
  } catch {
    return [];
  }
}

export type ShareArtKind = 'cg' | 'cover' | 'ending';
export interface ShareArtMeta { worldKey: string | null; worldTitle: string | null; caption: string | null; kind: ShareArtKind; path: string | null }
export interface ShareArtEntry extends ShareArtMeta { id: string; at: number; blob: Blob }

const DB = 'airp-share-art';
const STORE = 'art';
const KEEP = 16;
const MAX_EDGE = 1440;

let current: { key: string; title: string | null } | null = null;
/** The world on screen (App sets it): CGs shown now belong to it. */
export function setShareWorld(world: { key: string; title: string | null; coverSrc?: string | null } | null): void {
  current = world ? { key: world.key, title: world.title } : null;
  if (world?.coverSrc) void rememberFromUrl(world.coverSrc, { worldKey: world.key, worldTitle: world.title, caption: null, kind: 'cover', path: null });
}
export const shareWorld = () => current;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function all(db: IDBDatabase): Promise<ShareArtEntry[]> {
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as ShareArtEntry[]).sort((a, b) => b.at - a.at));
    req.onerror = () => resolve([]);
  });
}

/** Newest first: CGs (the current world's first), then covers. */
export async function listShareArt(): Promise<ShareArtEntry[]> {
  const db = await open();
  if (!db) return [];
  try {
    const list = await all(db);
    const here = current?.key ?? null;
    const rank = (e: ShareArtEntry) => (e.kind === 'cover' ? 2 : 0) + (here && e.worldKey !== here ? 1 : 0);
    return list.sort((a, b) => rank(a) - rank(b) || b.at - a.at);
  } finally {
    db.close();
  }
}

/** Downscale a loaded same-origin picture to a JPEG blob (null when it cannot be read — e.g. tainted). */
export async function pictureBlob(image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }): Promise<Blob | null> {
  try {
    const w0 = Number(image.naturalWidth ?? image.width) || 0;
    const h0 = Number(image.naturalHeight ?? image.height) || 0;
    if (!w0 || !h0 || typeof document === 'undefined') return null;
    const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w0 * scale);
    canvas.height = Math.round(h0 * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88));
  } catch {
    return null; // SecurityError: not same-origin — skip it
  }
}

/** Keep one picture (dedupe: the same world + path / the same world's cover replaces the older copy). */
export async function rememberShareArt(blob: Blob, meta: ShareArtMeta, at = Date.now()): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    const list = await all(db);
    const same = list.filter((e) => e.worldKey === meta.worldKey && e.kind === meta.kind && (meta.kind === 'cover' || e.path === meta.path));
    const extra = list.filter((e) => !same.includes(e)).slice(KEEP - 1);
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const e of [...same, ...extra]) store.delete(e.id);
      store.put({ ...meta, id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at, blob } satisfies ShareArtEntry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

/** A CG on screen (CgReveal's <img>, loaded): keep it for the share card. */
export async function rememberCg(image: HTMLImageElement, path: string, caption: string | null): Promise<void> {
  const blob = await pictureBlob(image);
  if (blob) await rememberShareArt(blob, { worldKey: current?.key ?? null, worldTitle: current?.title ?? null, caption, kind: 'cg', path });
}

async function rememberFromUrl(src: string, meta: ShareArtMeta): Promise<void> {
  if (typeof Image === 'undefined') return;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const blob = await pictureBlob(img);
    if (blob) await rememberShareArt(blob, meta);
  } catch {
    /* no cover */
  }
}
