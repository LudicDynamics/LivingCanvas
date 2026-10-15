// The world catalog: how the in-tab runtime learns which worlds exist and gets
// their bytes. ONE interface, shaped 1:1 on the Worldlines services:
//
//   listWorlds()          ← services: storage GET /v1/public/livingcanvas/worlds — NO token, so the
//                           lobby is browsable signed out (name, description, locale, cover_url);
//                           + identity GET /v1/resources?scope=mine for the player's drafts when
//                           signed in, enriched with world.json and cover refs from the bundle.
//                           host: the stand-in answers the identity shape for scope=public too.
//   getWorld(id, rev)     ← storage   GET /v1/objects/livingcanvas/world/<id>/download-url?revision=
//                           → {revision, hash, files: [{path, size, sha256, url}]}
//   getImage(ref)         ← a cover object in that world's storage revision
//   getBlob(file)         ← one file's bytes (content-addressed, verified, cached)
//
// Two configurations, same code:
//   { kind: 'host', base }                       the dev host's stand-in (apps/server
//                                                routes/browser-catalog.ts), which answers the
//                                                same shapes and inlines the manifest in `meta.world`
//   { kind: 'services', identity, storage, token } auth.worldlines.gg + storage.worldlines.gg
//
// Bytes are cached by sha256 in Cache Storage ("fetched once"): editions that
// share art (-zh / -jp / en) download it once, and a new revision only fetches
// the files whose hash changed.
//
// The guest trial's worlds ship WITH the static site: `trial` names
// `runtime/<rid>/trial.json` ({ worlds: [{ id, hash, size, world, files: [{path, size, sha256}] }] },
// deploy/canvas/assemble-browser.mjs `buildTrial`), whose blobs sit at the site's /trial-worlds/<sha256>.bin.
// The `.bin` matters: CloudFront's SPA function sends any path whose last segment has no dot to /index.html,
// so an extensionless /trial-worlds/<sha256> came back as the page (200 text/html) and every trial world failed
// its sha256 check → 502 「Could not download this world」 (canvas-20261011-0211).
// Those worlds open from there — no token, no storage download — so a signed-out player can play them,
// and they are listed even when storage's public list does not have them (or cannot be reached).
export type CatalogConfig =
  | { kind: 'host'; base: string }
  | { kind: 'services'; identity: string; storage: string; token?: () => Promise<string | null>; trial?: string | null };

export interface TrialIndex { worlds: { id: string; hash: string; size: number; world: Record<string, unknown>; files: FileRef[] }[] }
/** Where a trial.json's blobs are: two levels up from runtime/<rid>/, at /trial-worlds/. */
export const trialBlobBase = (trialUrl: string) => new URL('../../trial-worlds/', trialUrl).href;
/** A trial blob's file name under /trial-worlds/ (deploy/canvas/assemble-browser.mjs `trialBlobName`). */
export const trialBlobName = (sha256: string) => `${sha256}.bin`;

/**
 * Why a world could not be downloaded, for the player (worlds.ts maps it to the /api/worlds/load answer):
 *   `signed_out` storage wants an account (401 on download-url);
 *   `network`    the request never got an answer (offline, DNS, CORS) — trying again may work;
 *   `files`      an answer that is not the world's bytes (wrong hash, a web page instead of a file, 403/404/5xx).
 */
export type CatalogFailure = 'signed_out' | 'network' | 'files';
export class CatalogError extends Error {
  constructor(message: string, readonly kind: CatalogFailure, readonly status?: number) { super(message); this.name = 'CatalogError'; }
}
/** The failure kind of anything getWorld / getBlob threw. */
export function catalogFailureOf(e: unknown): CatalogFailure {
  if (e instanceof CatalogError) return e.kind;
  const msg = e instanceof Error ? e.message : String(e);
  if (/catalog: 401\b/.test(msg)) return 'signed_out';
  if (e instanceof TypeError || /Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'network';
  return 'files';
}
/** fetch, with a network failure (TypeError) labelled as one. */
async function fetchOrNetwork(url: string, init?: RequestInit): Promise<Response> {
  try { return await fetch(url, init); } catch (e) { throw new CatalogError(`catalog: network error fetching ${url.split('?')[0]}: ${(e as Error).message}`, 'network'); }
}

export interface FileRef { path: string; size: number; sha256: string }
export interface CatalogWorld {
  /** Resource id (`livingcanvas/world/<id>`): a template edition id (`whitechapel-zh`) or a made world (`made-…`). */
  id: string;
  source: 'template' | 'published' | 'draft';
  title: string; description: string; locale: string | null;
  /** Edition group: the editions of one world share it (`whitechapel`). */
  edition: string;
  exp: boolean; owner: string; mine: boolean; status: string;
  revision: number; hash: string; size: number;
  /** The world's world.json. */
  world: Record<string, unknown>;
  cover: FileRef | null; coverVideo: FileRef | null;
  /** Public-list entries: the cover as an unauthenticated URL (storage `…/cover?rev=`), no file ref. */
  coverUrl?: string | null;
}
export interface WorldBundle { id: string; revision: number; hash: string; size: number; files: (FileRef & { url: string })[] }
export interface ImageRef { world: string; revision: number; file: FileRef }

export interface WorldCatalog {
  listWorlds(): Promise<CatalogWorld[]>;
  getWorld(id: string, revision?: number): Promise<WorldBundle>;
  getImage(ref: ImageRef): Promise<Uint8Array>;
  getBlob(file: FileRef & { url?: string }, world?: { id: string; revision: number }): Promise<Uint8Array>;
  /** Is this blob already cached locally (no network needed)? Sync, from the in-memory index. */
  hasBlob(sha256: string, size?: number): boolean;
  readCachedBlob(sha256: string): Promise<Uint8Array | null>;
  /** A public cover by URL (no token), cached by URL; `type` from the response. */
  getPublicImage(url: string): Promise<{ bytes: Uint8Array; type: string }>;
}

const CACHE = 'airp-world-blobs-v1';
const COVERS = 'airp-public-covers-v1';
const blobKey = (sha: string) => `https://airp-blob.invalid/${sha}`;
const IMAGE = /\.(webp|png|jpe?g|avif)$/i;
const VIDEO = /\.(webm|mp4)$/i;

async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b));
  let s = '';
  for (const x of d) s += x.toString(16).padStart(2, '0');
  return s;
}

/** The launcher cover rule of apps/server world-shelf.ts (coverOf / coverVideoOf), over a file list. */
export function pickCovers(world: Record<string, unknown>, files: FileRef[]) {
  const by = new Map(files.map((f) => [f.path, f]));
  const declared = (k: string, re: RegExp) => { const v = typeof world[k] === 'string' ? (world[k] as string).replace(/^\/+/, '') : ''; return v && re.test(v) ? by.get(v) ?? null : null; };
  const first = (folders: string[], re: RegExp, pick: (names: string[]) => string | undefined) => {
    for (const folder of folders) {
      const names = files.filter((f) => f.path.startsWith(`${folder}/`) && !f.path.slice(folder.length + 1).includes('/') && re.test(f.path)).map((f) => f.path.slice(folder.length + 1)).sort();
      const n = pick(names);
      if (n) return by.get(`${folder}/${n}`) ?? null;
    }
    return null;
  };
  return {
    cover: declared('cover', IMAGE) ?? first(['assets/scenes', 'assets/backgrounds'], IMAGE, (ns) => ns.find((n) => /^intro\./i.test(n)) ?? ns[0]),
    coverVideo: declared('coverVideo', VIDEO) ?? first(['assets/motion/seedance/backgrounds', 'assets/scenes'], VIDEO, (ns) => ns.find((n) => /^intro\.webm$/i.test(n)) ?? ns.find((n) => /^intro[.-]/i.test(n))),
  };
}

/**
 * One entry of storage's public list → a catalog world. The stub world.json is
 * what the launcher needs (name, description, locale, a declared cover path);
 * the real world.json replaces it when the world is opened. Official editions
 * keep their template ids; worlds made by players are `made-…`.
 */
export function publicEntry(e: any, storage: string): CatalogWorld | null {
  if (!e || typeof e.id !== 'string' || typeof e.hash !== 'string' || !(e.revision > 0)) return null;
  const coverPath = 'assets/scenes/intro.catalog-cover.webp';
  const coverUrl = typeof e.cover_url === 'string' && e.cover_url ? new URL(e.cover_url, `${storage}/`).href : null;
  const world: Record<string, unknown> = { id: e.id, name: e.name ?? e.id, description: e.description ?? '', ...(e.locale ? { locale: e.locale } : {}), ...(coverUrl ? { cover: coverPath } : {}) };
  return {
    id: e.id, source: /^made-/.test(e.id) ? 'published' : 'template',
    title: String(e.name ?? e.id), description: String(e.description ?? ''), locale: e.locale ?? null,
    edition: e.edition_group ?? String(e.id).replace(/-(zh|jp|ko|en)$/, ''),
    exp: false, owner: String(e.publisher ?? ''), mine: false, status: 'published',
    revision: e.revision, hash: e.hash, size: e.size ?? 0, world,
    cover: coverUrl ? { path: coverPath, size: 0, sha256: '' } : null, coverVideo: null, coverUrl,
  };
}

export function createCatalog(config: CatalogConfig): WorldCatalog {
  const identity = (config.kind === 'host' ? config.base : config.identity).replace(/\/$/, '');
  const storage = (config.kind === 'host' ? config.base : config.storage).replace(/\/$/, '');
  const token = config.kind === 'services' ? config.token : undefined;
  const trialUrl = config.kind === 'services' ? config.trial ?? null : null;
  let trial: Promise<TrialIndex | null> | null = null;
  /** The shipped trial worlds (null = none / unreadable: everything comes from storage as before). */
  const trialIndex = () => (trial ??= !trialUrl ? Promise.resolve(null) : fetch(trialUrl).then((r) => (r.ok ? r.json() : null)).then((j) => (j && Array.isArray(j.worlds) ? j as TrialIndex : null)).catch(() => null));
  async function trialBundle(id: string): Promise<WorldBundle | null> {
    const t = (await trialIndex())?.worlds.find((w) => w.id === id);
    if (!t || !trialUrl) return null;
    const base = trialBlobBase(trialUrl);
    return { id, revision: 0, hash: t.hash, size: t.size, files: t.files.map((f) => ({ ...f, url: new URL(trialBlobName(f.sha256), base).href })) };
  }
  const known = new Map<string, number>(); // sha256 → size, blobs in Cache Storage
  // `${id}@${revision}` → bundle. Its file URLs are storage's presigned GETs (STORAGE_URL_TTL_SEC, 300 s by
  // default), so an entry is only reused while its URLs are still fresh; a lobby prefetch followed by an open
  // minutes later used to download with expired links → 403 → 「Could not download this world」 (10-10).
  const BUNDLE_FRESH_MS = 4 * 60_000;
  const bundles = new Map<string, WorldBundle & { at: number }>();
  let cache: Cache | null = null;
  let indexed: Promise<void> | null = null;

  async function blobCache() {
    if (!cache) cache = await caches.open(CACHE);
    indexed ??= (async () => {
      for (const req of await cache!.keys()) {
        const sha = req.url.slice(req.url.lastIndexOf('/') + 1);
        known.set(sha, -1);
      }
    })();
    await indexed;
    return cache;
  }

  async function get(url: string) {
    const headers: Record<string, string> = {};
    const t = await token?.();
    if (t) headers.authorization = `Bearer ${t}`;
    const r = await fetchOrNetwork(url, { headers });
    if (!r.ok) throw new CatalogError(`catalog: ${r.status} ${url}`, r.status === 401 ? 'signed_out' : 'files', r.status);
    return r.json();
  }

  async function getWorld(id: string, revision?: number): Promise<WorldBundle> {
    // A trial world: the copy shipped with the site, whatever revision storage is at (same repo, same deploy).
    const shipped = await trialBundle(id);
    if (shipped) return shipped;
    const hit = revision !== undefined ? bundles.get(`${id}@${revision}`) : undefined;
    if (hit && Date.now() - hit.at < BUNDLE_FRESH_MS) return hit;
    const at = `${storage}/v1/objects/livingcanvas/world/${encodeURIComponent(id)}/download-url`;
    // The lobby's revision can be gone by the time the world opens (republished meanwhile, the old one pruned):
    // a 404 / 410 for that revision falls back to the current one rather than failing the open.
    const r = revision === undefined ? await get(at) : await get(`${at}?revision=${revision}`).catch((e) => {
      if (e instanceof CatalogError && (e.status === 404 || e.status === 410)) return get(at);
      throw e;
    });
    const files = (r.files as any[]).map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, url: new URL(f.url, storage.startsWith('http') ? storage : self.location.href).href }));
    const b = { id, revision: r.revision, hash: r.hash, size: r.size, files, at: Date.now() };
    bundles.set(`${id}@${b.revision}`, b);
    return b;
  }

  // One download per blob at a time: a world being opened and the same world being prefetched (or two
  // editions sharing art) wait for the same request instead of fetching it twice.
  const inflight = new Map<string, Promise<Uint8Array>>();
  function getBlob(file: FileRef & { url?: string }, world?: { id: string; revision: number }): Promise<Uint8Array> {
    let p = inflight.get(file.sha256);
    if (!p) {
      p = fetchBlob(file, world).finally(() => inflight.delete(file.sha256));
      inflight.set(file.sha256, p);
    }
    return p;
  }

  async function fetchBlob(file: FileRef & { url?: string }, world?: { id: string; revision: number }): Promise<Uint8Array> {
    const c = await blobCache();
    const cached = await c.match(blobKey(file.sha256));
    if (cached) return new Uint8Array(await cached.arrayBuffer());
    const urlFor = async () => (world ? (await getWorld(world.id, world.revision)).files.find((f) => f.sha256 === file.sha256)?.url : undefined);
    let url = world ? await urlFor() : file.url;
    url ??= file.url;
    if (!url) throw new Error(`catalog: no url for blob ${file.sha256}`);
    let r = await fetchOrNetwork(url);
    // An expired / rejected presigned link: ask storage for fresh ones once and retry.
    if ((r.status === 403 || r.status === 400 || r.status === 401) && world) {
      bundles.delete(`${world.id}@${world.revision}`);
      const fresh = await urlFor();
      if (fresh) r = await fetchOrNetwork(fresh);
    }
    if (!r.ok) throw new CatalogError(`catalog: ${r.status} fetching ${file.path}`, 'files', r.status);
    // A static host's SPA fallback answers a missing file with the app's index.html (200): say so, not just "sha256".
    if (/^text\/html\b/i.test(r.headers.get('content-type') ?? '') && !/\.html?$/i.test(file.path)) {
      throw new CatalogError(`catalog: ${file.path} came back as a web page (${url.split('?')[0]} is missing on the server)`, 'files');
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length !== file.size || (await sha256Hex(bytes)) !== file.sha256) throw new CatalogError(`catalog: ${file.path} does not match its sha256`, 'files');
    await c.put(blobKey(file.sha256), new Response(bytes, { headers: { 'content-length': String(bytes.length) } }));
    known.set(file.sha256, bytes.length);
    return bytes;
  }

  async function enrich(r: any, source: CatalogWorld['source']): Promise<CatalogWorld | null> {
    const m = r.meta ?? {};
    let world = m.world as Record<string, unknown> | undefined;
    let cover: FileRef | null = m.cover ?? null, coverVideo: FileRef | null = m.coverVideo ?? null;
    if (!world) {
      // Plain identity listing: read world.json (and pick covers) from the current revision.
      const b = await getWorld(r.id, r.revision).catch(() => null);
      const wj = b?.files.find((f) => f.path === 'world.json');
      if (!b || !wj) return null;
      world = JSON.parse(new TextDecoder().decode(await getBlob(wj)));
      ({ cover, coverVideo } = pickCovers(world!, b.files));
    }
    return {
      id: r.id, source: m.source === 'template' ? 'template' : source,
      title: String(r.title ?? world!.name ?? r.id), description: String(m.description ?? world!.description ?? ''),
      locale: m.locale ?? (typeof world!.locale === 'string' ? world!.locale : null),
      edition: m.edition ?? String(r.id).replace(/-(zh|jp|ko|en)$/, ''),
      exp: m.exp ?? world!.exp === true, owner: r.owner_id, mine: !!r.mine, status: r.status,
      revision: r.revision, hash: r.hash, size: r.size, world: world!, cover, coverVideo,
    };
  }

  async function list(scope: 'public' | 'mine') {
    const out: any[] = [];
    let cursor: string | null = null;
    do {
      const r: any = await get(`${identity}/v1/resources?scope=${scope}&product=livingcanvas&kind=world&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      out.push(...r.resources);
      cursor = r.next_cursor ?? null;
    } while (cursor);
    return out;
  }

  async function publicList(): Promise<CatalogWorld[]> {
    const r = await fetch(`${storage}/v1/public/livingcanvas/worlds`, { credentials: 'omit' });
    if (!r.ok) throw new Error(`catalog: ${r.status} public list`);
    const body = await r.json();
    return (Array.isArray(body?.worlds) ? body.worlds : []).map((e: any) => publicEntry(e, storage)).filter((w: CatalogWorld | null): w is CatalogWorld => !!w);
  }

  return {
    async listWorlds() {
      await blobCache();
      if (config.kind === 'services') {
        const shipped = (await trialIndex())?.worlds ?? [];
        // Storage unreachable: the shipped trial worlds still make a lobby.
        const pub = await publicList().catch((e) => { if (!shipped.length) throw e; return [] as CatalogWorld[]; });
        const listed = new Set(pub.map((w) => w.id));
        for (const t of shipped) {
          if (listed.has(t.id)) continue;
          const { cover, coverVideo } = pickCovers(t.world, t.files);
          pub.push({
            id: t.id, source: 'template', title: String(t.world.name ?? t.id), description: String(t.world.description ?? ''),
            locale: typeof t.world.locale === 'string' ? t.world.locale : null, edition: String(t.id).replace(/-(zh|jp|ko|en)$/, ''),
            exp: false, owner: '', mine: false, status: 'published', revision: 0, hash: t.hash, size: t.size, world: t.world, cover, coverVideo,
          });
        }
        const mine = token && (await token()) ? await list('mine').catch(() => []) : [];
        const seen = new Set(pub.map((w) => w.id));
        const drafts = await Promise.all(mine.filter((r) => !seen.has(r.id) && r.hash && r.status !== 'published').map((r) => enrich(r, 'draft')));
        return [...pub, ...drafts.filter((w): w is CatalogWorld => !!w)];
      }
      const pub = await list('public');
      const mine = token && (await token()) ? await list('mine').catch(() => []) : [];
      const seen = new Set(pub.map((r) => r.id));
      const all = await Promise.all([
        ...pub.filter((r) => r.hash).map((r) => enrich(r, 'published')),
        ...mine.filter((r) => !seen.has(r.id) && r.hash).map((r) => enrich(r, 'draft')),
      ]);
      return all.filter((w): w is CatalogWorld => !!w);
    },
    getWorld,
    getImage: (ref) => getBlob(ref.file, { id: ref.world, revision: ref.revision }),
    getBlob,
    hasBlob: (sha, size) => { const s = known.get(sha); return s !== undefined && (s === -1 || size === undefined || s === size); },
    async getPublicImage(url) {
      const c = await caches.open(COVERS);
      let r = await c.match(url);
      if (!r) {
        const net = await fetch(url, { credentials: 'omit' });
        if (!net.ok) throw new Error(`catalog: ${net.status} cover`);
        const type = net.headers.get('content-type') ?? 'application/octet-stream';
        if (!/^image\//.test(type)) throw new Error(`catalog: cover is ${type}`);
        const bytes = new Uint8Array(await net.arrayBuffer());
        r = new Response(bytes, { headers: { 'content-type': type } });
        // `?rev=` pins the bytes: keep them (a new revision is a new URL).
        if (/[?&]rev=\d+/.test(url)) await c.put(url, r.clone());
      }
      return { bytes: new Uint8Array(await r.arrayBuffer()), type: r.headers.get('content-type') ?? 'application/octet-stream' };
    },
    async readCachedBlob(sha) {
      const hit = await (await blobCache()).match(blobKey(sha));
      return hit ? new Uint8Array(await hit.arrayBuffer()) : null;
    },
  };
}
