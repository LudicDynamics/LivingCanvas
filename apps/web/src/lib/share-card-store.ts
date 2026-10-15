/**
 * every share card the player downloaded or shared is kept in this browser's
 * IndexedDB — the PNG blob plus what it shows (world, ending, the CG it was drawn from, invite / result, layout,
 * language, when) — so the account popup's CG tab can list the cards made from a CG and a 「我的分享卡」 strip.
 *
 * At most CAP cards, least recently used dropped first. The same card saved again (same picture, kind, layout,
 * language, ending and size) replaces the older copy. Local only: nothing is uploaded, other devices do not see
 * these (cloud sync is out of scope, the design notes §分享卡). No IndexedDB (tests, private modes) → the
 * default store falls back to memory for this page view; nothing breaks.
 *
 * The storage sits behind a tiny backend interface, so the store logic is unit-tested on the memory backend
 * (apps/web/test/share-card-store.test.mjs).
 */

export type ShareCardKind = 'invite' | 'result';
export interface ShareCardMeta {
  kind: ShareCardKind;
  format: 'portrait' | 'landscape';
  locale: string;
  worldKey: string | null;
  worldTitle: string | null;
  endingTitle: string | null;
  /** The CG (world-relative path) the card was drawn from; null = cover / painted art. */
  cgPath: string | null;
}
export interface ShareCardRecord extends ShareCardMeta { id: string; createdAt: number; usedAt: number; blob: Blob }

export interface ShareCardBackend {
  all(): Promise<ShareCardRecord[]>;
  put(record: ShareCardRecord): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
}

export const SHARE_CARD_CAP = 50;
/** Fired on window after a save or delete: open lists re-read. */
export const SHARE_CARDS_CHANGED = 'airp:share-cards-changed';

export function memoryBackend(): ShareCardBackend {
  const rows = new Map<string, ShareCardRecord>();
  return {
    async all() { return [...rows.values()]; },
    async put(r) { rows.set(r.id, r); },
    async remove(ids) { for (const id of ids) rows.delete(id); },
  };
}

const DB = 'airp-share-cards';
const STORE = 'cards';

/** IndexedDB backend; null when there is no IndexedDB. Each call opens and closes the database (rare, small). */
export function indexedDbBackend(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): ShareCardBackend | null {
  if (!factory) return null;
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> => {
    const db = await open();
    try {
      return await new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    async all() { return (await run<ShareCardRecord[]>('readonly', (s) => s.getAll())) ?? []; },
    async put(r) { await run('readwrite', (s) => { s.put(r); }); },
    async remove(ids) { await run('readwrite', (s) => { for (const id of ids) s.delete(id); }); },
  };
}

const sameCard = (a: ShareCardMeta, b: ShareCardMeta) =>
  a.kind === b.kind && a.format === b.format && a.locale === b.locale && a.worldKey === b.worldKey && a.endingTitle === b.endingTitle && a.cgPath === b.cgPath;

export interface ShareCardStore {
  /** Keep a card (newest first afterwards). → its record. */
  save(blob: Blob, meta: ShareCardMeta): Promise<ShareCardRecord>;
  /** Newest used first; optionally only one CG's cards (`cgPath` + `worldKey`). */
  list(filter?: { cgPath?: string; worldKey?: string | null }): Promise<ShareCardRecord[]>;
  /** Mark as used now (opened / downloaded again): it is dropped last. */
  touch(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createShareCardStore(backend: ShareCardBackend, opts: { cap?: number; now?: () => number; onChange?: () => void } = {}): ShareCardStore {
  const cap = Math.max(1, opts.cap ?? SHARE_CARD_CAP);
  const now = opts.now ?? (() => Date.now());
  const changed = () => opts.onChange?.();
  let seq = 0;
  const sorted = async () => (await backend.all()).sort((a, b) => b.usedAt - a.usedAt || b.createdAt - a.createdAt);
  return {
    async save(blob, meta) {
      const at = now();
      const list = await sorted();
      const dupes = list.filter((r) => sameCard(r, meta) && r.blob.size === blob.size).map((r) => r.id);
      const record: ShareCardRecord = { ...meta, id: `${at.toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`, createdAt: at, usedAt: at, blob };
      const keep = list.filter((r) => !dupes.includes(r.id));
      const over = keep.slice(Math.max(0, cap - 1)).map((r) => r.id);
      if (dupes.length || over.length) await backend.remove([...dupes, ...over]);
      await backend.put(record);
      changed();
      return record;
    },
    async list(filter) {
      const list = await sorted();
      if (!filter?.cgPath) return list;
      return list.filter((r) => r.cgPath === filter.cgPath && (filter.worldKey === undefined || r.worldKey === filter.worldKey));
    },
    async touch(id) {
      const r = (await backend.all()).find((x) => x.id === id);
      if (!r) return;
      await backend.put({ ...r, usedAt: Math.max(now(), r.usedAt + 1) });
    },
    async remove(id) {
      await backend.remove([id]);
      changed();
    },
  };
}

let shared: ShareCardStore | null = null;
/** This browser's store (IndexedDB, else memory); errors read as an empty list, never thrown at the UI. */
export function shareCards(): ShareCardStore {
  if (shared) return shared;
  const idb = indexedDbBackend();
  const fallback = memoryBackend();
  const safe: ShareCardBackend = idb ? {
    all: () => idb.all().catch(() => fallback.all()),
    put: (r) => idb.put(r).catch(() => fallback.put(r)),
    remove: (ids) => idb.remove(ids).catch(() => fallback.remove(ids)),
  } : fallback;
  shared = createShareCardStore(safe, { onChange: () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(SHARE_CARDS_CHANGED)); } });
  return shared;
}
