// Persistence for the VFS: the base image (presets, extensions, catalog stubs)
// comes from the network on every boot; everything the server writes on top of
// it (worlds, saves, sessions, SQLite files, settings) is an OVERLAY kept in
// OPFS, or IndexedDB where OPFS is missing. One tab owns the store (Web Lock);
// a second tab runs volatile.
//
// Change detection is incremental: memfs reports every mutation on its
// volume-level change bus (path writes, fd writes, streams, renames, recursive
// deletes — anything that goes through the volume), so a flush only looks at the
// paths touched since the last one. An explicit flush can still ask for a full
// scan (`flush({ full: true })`) as a safety net.
//
// Writes never block the Worker for long: OPFS files are written with the
// async `createWritable()` stream (the I/O happens off-thread) and the loop
// yields between files, so /api requests and socket frames keep flowing while
// a new game's copy is being saved.
//
// Files that are byte-identical to a catalog blob (a new game copies the whole
// template) are stored as a reference `{path → sha256}` in the meta file, not as
// bytes; on restore the bytes come from the blob cache (see catalog.ts).
import { fs, vol } from './fs';

const SKIP = /^\/(tmp|proc|dev)(\/|$)|^\/repo\/templates\//;
const META = '.airp-overlay-meta.json';
const REF_MIN = 4096;
type Backend = {
  kind: string;
  loadAll(): Promise<Map<string, Uint8Array>>;
  put(p: string, b: Uint8Array): Promise<void>;
  remove(p: string): Promise<void>;
  clear(): Promise<void>;
};

async function opfsBackend(ns: string): Promise<Backend> {
  const root = await (navigator as any).storage.getDirectory();
  let dir = await root.getDirectoryHandle(ns, { create: true });
  let dirs = new Map<string, any>();
  const parts = (p: string) => p.split('/').filter(Boolean);
  async function parent(p: string, create: boolean) {
    const ps = parts(p);
    let d = dir, key = '';
    for (const seg of ps.slice(0, -1)) {
      key += `/${seg}`;
      const hit = dirs.get(key);
      if (hit) { d = hit; continue; }
      d = await d.getDirectoryHandle(seg, { create });
      dirs.set(key, d);
    }
    return { d, name: ps[ps.length - 1] };
  }
  return {
    kind: 'opfs',
    async loadAll() {
      const out = new Map<string, Uint8Array>();
      const walk = async (d: any, prefix: string) => {
        for await (const [name, h] of d.entries()) {
          if (h.kind === 'directory') await walk(h, `${prefix}/${name}`);
          else out.set(`${prefix}/${name}`, new Uint8Array(await (await h.getFile()).arrayBuffer()));
        }
      };
      await walk(dir, '');
      return out;
    },
    async put(p, b) {
      const { d, name } = await parent(p, true);
      const fh = await d.getFileHandle(name, { create: true });
      if (fh.createWritable) {
        const w = await fh.createWritable();
        await w.write(b);
        await w.close();
      } else {
        const h = await fh.createSyncAccessHandle();
        try { h.truncate(0); h.write(b, { at: 0 }); h.flush(); } finally { h.close(); }
      }
    },
    async remove(p) {
      try { const { d, name } = await parent(p, false); await d.removeEntry(name); } catch { /* already gone */ }
    },
    async clear() {
      await root.removeEntry(ns, { recursive: true }).catch(() => {});
      dir = await root.getDirectoryHandle(ns, { create: true });
      dirs = new Map();
    },
  };
}

async function idbBackend(ns: string): Promise<Backend> {
  const db: IDBDatabase = await new Promise((res, rej) => {
    const r = indexedDB.open(`airp-vfs-${ns}`, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void) => new Promise<T>((res, rej) => {
    const t = db.transaction('files', mode);
    const r = f(t.objectStore('files'));
    t.oncomplete = () => res(r ? (r as IDBRequest<T>).result : (undefined as T));
    t.onerror = () => rej(t.error);
  });
  return {
    kind: 'indexeddb',
    async loadAll() {
      const out = new Map<string, Uint8Array>();
      const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
      const vals = await tx<any[]>('readonly', (s) => s.getAll());
      keys.forEach((k, i) => out.set(String(k), new Uint8Array(vals[i])));
      return out;
    },
    put: (p, b) => tx('readwrite', (s) => { s.put(b, p); }),
    remove: (p) => tx('readwrite', (s) => { s.delete(p); }),
    clear: () => tx('readwrite', (s) => { s.clear(); }),
  };
}

const sig = (st: any) => `${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
function scanTree(root: string, out = new Map<string, string>(), skip: (p: string) => boolean = (p) => SKIP.test(p)): Map<string, string> {
  const walk = (d: string) => {
    let list: any[];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = d === '/' ? `/${e.name}` : `${d}/${e.name}`;
      if (skip(p)) continue;
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.set(p, sig(fs.statSync(p)));
    }
  };
  walk(root);
  return out;
}

async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b));
  let s = '';
  for (const x of d) s += x.toString(16).padStart(2, '0');
  return s;
}

/** Where catalog blobs live: lets the overlay store "same bytes as blob X" instead of the bytes. */
export interface BlobStore { has(sha256: string, size: number): boolean; read(sha256: string): Promise<Uint8Array | null> }
export interface FlushResult { written: number; referenced: number; removed: number; ms: number }
export interface Persistence {
  kind: string; restored: number;
  flush(opts?: { full?: boolean }): Promise<FlushResult>;
  reset(): Promise<void>;
  /** Paths under `root` are not part of the overlay (e.g. a catalog world materialised in place). */
  ignore(root: string): void;
}

/** Restore the overlay onto the volume (call after the base image is written), then track changes. */
export async function startPersistence(ns = 'default', onError: (e: unknown) => void = () => {}, blobs?: BlobStore): Promise<Persistence | null> {
  const locks = (navigator as any).locks;
  if (locks) {
    const got = await new Promise<boolean>((res) => {
      locks.request(`airp-vfs-${ns}`, { ifAvailable: true }, (lock: any) => { res(!!lock); return lock ? new Promise(() => {}) : undefined; });
    });
    if (!got) return null; // another tab owns this store
  }
  const backend = (navigator as any).storage?.getDirectory ? await opfsBackend(ns).catch(() => idbBackend(ns)) : await idbBackend(ns);
  const ignored: string[] = [];
  const skip = (p: string) => SKIP.test(p) || ignored.some((r) => p === r || p.startsWith(`${r}/`));
  const base = new Set(scanTree('/').keys());
  const stored = await backend.loadAll();
  const metaBytes = stored.get(`/${META}`);
  stored.delete(`/${META}`);
  const meta = metaBytes ? JSON.parse(new TextDecoder().decode(metaBytes)) : {};
  const deleted = new Set<string>(meta.deleted ?? []);
  const refs = new Map<string, string>(Object.entries(meta.refs ?? {}));
  const put = (p: string, b: Uint8Array) => { fs.mkdirSync(p.slice(0, p.lastIndexOf('/')) || '/', { recursive: true }); fs.writeFileSync(p, b); };
  for (const [p, b] of stored) put(p, b);
  for (const [p, sha] of refs) {
    if (stored.has(p)) { refs.delete(p); continue; }
    const b = await blobs?.read(sha).catch(() => null);
    if (b) put(p, b); else { refs.delete(p); onError(`overlay: blob ${sha.slice(0, 12)} for ${p} is gone`); }
  }
  for (const p of deleted) try { fs.rmSync(p, { force: true }); } catch { /* not there */ }

  // Track mutations from here on (restoring above is not a change).
  const dirty = new Set<string>();
  let timer: any = null;
  const schedule = () => { if (!timer) timer = setTimeout(() => { timer = null; flush().catch(onError); }, 400); };
  (vol as any)._core.changes.listen((ev: any) => {
    const p = `/${ev.steps.join('/')}`;
    if (!skip(p)) dirty.add(p);
    if (ev.oldSteps) { const o = `/${ev.oldSteps.join('/')}`; if (!skip(o)) dirty.add(o); }
    schedule();
  });
  let saved = scanTree('/', new Map(), skip);

  const stats = ((globalThis as any).__airpStats ??= {}).persist = { flushes: 0, totalMs: 0, maxMs: 0, written: 0, referenced: 0, bytes: 0 };
  let running: Promise<any> = Promise.resolve();
  async function flushOnce(full: boolean): Promise<FlushResult> {
    const t = performance.now();
    // What changed: every dirty path is re-read now (a file, a whole directory after
    // a move/copy, or gone). A full scan compares the whole volume instead.
    const now = new Map<string, string>();
    const gone = new Set<string>();
    if (full) {
      scanTree('/', now, skip);
      for (const p of saved.keys()) if (!now.has(p)) gone.add(p);
    } else {
      const paths = [...dirty];
      dirty.clear();
      for (const p of paths) {
        let st: any = null;
        try { st = fs.statSync(p); } catch { /* gone */ }
        if (st?.isFile()) now.set(p, sig(st));
        else if (st?.isDirectory()) scanTree(p, now, skip);
        else {
          gone.add(p);
          const prefix = `${p}/`;
          for (const q of saved.keys()) if (q.startsWith(prefix)) gone.add(q);
        }
      }
      for (const p of gone) if (now.has(p)) gone.delete(p);
    }
    let written = 0, referenced = 0, removed = 0, metaDirty = false, sinceYield = performance.now();
    for (const [p, s] of now) {
      if (saved.get(p) === s) continue;
      const b = new Uint8Array(fs.readFileSync(p));
      const sha = blobs && b.length >= REF_MIN ? await sha256Hex(b) : null;
      if (sha && blobs!.has(sha, b.length)) {
        if (refs.get(p) !== sha) { refs.set(p, sha); metaDirty = true; }
        await backend.remove(p);
        referenced++;
      } else {
        await backend.put(p, b);
        if (refs.delete(p)) metaDirty = true;
        written++;
        stats.bytes += b.length;
      }
      saved.set(p, s);
      if (deleted.delete(p)) metaDirty = true;
      // Keep the Worker answering while a big batch is saved.
      if (performance.now() - sinceYield > 8) { await new Promise((r) => setTimeout(r, 0)); sinceYield = performance.now(); }
    }
    for (const p of gone) {
      if (!saved.has(p) && !base.has(p)) continue;
      if (saved.delete(p)) { await backend.remove(p); removed++; }
      if (refs.delete(p)) metaDirty = true;
      if (base.has(p) && !deleted.has(p)) { deleted.add(p); metaDirty = true; }
    }
    if (metaDirty) await backend.put(`/${META}`, new TextEncoder().encode(JSON.stringify({ deleted: [...deleted], refs: Object.fromEntries(refs) })));
    const ms = Math.round(performance.now() - t);
    stats.flushes++; stats.totalMs += ms; stats.maxMs = Math.max(stats.maxMs, ms); stats.written += written; stats.referenced += referenced;
    return { written, referenced, removed, ms };
  }
  const flush = (opts: { full?: boolean } = {}) => (running = running.then(() => flushOnce(!!opts.full), () => flushOnce(!!opts.full)));

  return {
    kind: backend.kind,
    restored: stored.size + refs.size,
    flush,
    reset: async () => { await backend.clear(); deleted.clear(); refs.clear(); dirty.clear(); saved = scanTree('/', new Map(), skip); },
    ignore(root: string) {
      ignored.push(root.replace(/\/$/, ''));
      for (const p of [...saved.keys()]) if (skip(p)) saved.delete(p);
      for (const p of [...dirty]) if (skip(p)) dirty.delete(p);
    },
  };
}
