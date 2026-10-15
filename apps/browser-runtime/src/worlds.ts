// Worlds in the VFS, from the catalog (catalog.ts). At boot every listed world
// gets a STUB where the server looks for it — `templates/<id>/` for official
// editions, `worlds/published/<id>/` for published made worlds: its world.json
// plus 0-byte placeholders at its cover paths. That is all the server needs to
// render the launcher shelf (readWorldShelf only reads world.json and checks the
// cover files exist). The stub's cover requests are answered from the catalog.
//
// Opening a world (POST /api/worlds/load of `templates/<id>` or `published/<id>`)
// first materialises it: the bundle's files are fetched (or read from the blob
// cache) and written over the stub, THEN the request reaches the server, whose
// load copies it into a save as usual. Materialised files are not part of the
// persisted overlay — the blob cache is their persistence — and a world whose
// catalog hash changed is fetched again on its next open.
import { fs } from './platform/fs';
import { catalogFailureOf, type CatalogWorld, type WorldCatalog } from './catalog';

const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', avif: 'image/avif', webm: 'video/webm', mp4: 'video/mp4' };
type Answer = { status: number; headers: Record<string, string>; body: Uint8Array };

/**
 * The lobby cards shipped next to the runtime as
 * `intros.json` (deploy/canvas/assemble-browser.mjs `buildIntros`): the
 * public catalog lists only a world's name, description and cover, so the
 * stub world.json gets its `intro`, `rules` and cast from here, and the cards'
 * portraits come from /world-intros/<file>.
 */
export interface IntroIndex {
  worlds: Record<string, { intro: Record<string, unknown>; rules?: unknown; characters?: { id: string; avatar?: string }[]; avatars: Record<string, string> }>;
}
export type IntroSource = () => Promise<{ index: IntroIndex; avatarBase: string } | null>;

/** `intros.json` beside worker.js; the portraits two levels up, at the site's /world-intros/. Null where there is none (the dev host). */
export const siteIntros: IntroSource = async () => {
  const at = (globalThis as { location?: { href: string } }).location?.href;
  if (!at || typeof fetch !== 'function') return null;
  const url = new URL('intros.json', at);
  const r = await fetch(url.href);
  if (!r.ok) return null;
  const index = await r.json() as IntroIndex;
  return index && typeof index.worlds === 'object' ? { index, avatarBase: new URL('../../world-intros/', url).href } : null;
};

/** World-relative portrait path of each cast member on a card (apps/server lobby-intro.ts `introCast`). */
export function introCastPaths(world: Record<string, unknown>): (string | null)[] {
  const intro = world.intro as { characters?: { id?: string; avatar?: string }[] } | undefined;
  const characters = Array.isArray(world.characters) ? world.characters as { id?: string; avatar?: string }[] : [];
  return (Array.isArray(intro?.characters) ? intro!.characters : []).map((c) => c.avatar ?? characters.find((x) => x.id === c.id)?.avatar ?? null);
}

/** The catalog's stub world.json with the shipped card merged in (never over what the catalog sent). */
export function withIntro(world: Record<string, unknown>, entry: IntroIndex['worlds'][string] | undefined): Record<string, unknown> {
  if (!entry || world.intro) return world;
  return { ...world, intro: entry.intro, ...(world.rules || !entry.rules ? {} : { rules: entry.rules }), ...(Array.isArray(world.characters) || !entry.characters ? {} : { characters: entry.characters }) };
}

export class WorldLibrary {
  private worlds = new Map<string, CatalogWorld>(); // key: `${kind}/${id}` (kind: templates | published)
  private stubs = new Map<string, Set<string>>(); // key → the stub files written
  private ready = new Map<string, string>(); // key → materialised hash
  private pending = new Map<string, Promise<void>>();
  private portraits = new Map<string, { cast: (string | null)[]; files: Record<string, string>; base: string }>(); // key → the card's portraits
  stats = {
    listed: 0, listMs: 0,
    opened: [] as { id: string; ms: number; files: number; fetched: number }[],
    prefetched: [] as { id: string; ms: number; files: number; fetched: number; stopped?: boolean }[],
  };
  /** Bumped by every prefetch and every open: a running prefetch stops at its next file once it is stale. */
  private prefetchGen = 0;

  constructor(private catalog: WorldCatalog, private repo = '/repo', private onIgnore: (root: string) => void = () => {}, private intros: IntroSource = siteIntros) {}

  private root(key: string) { const [kind, id] = key.split('/'); return kind === 'templates' ? `${this.repo}/templates/${id}` : `${this.repo}/worlds/published/${id}`; }
  private keyOf(w: CatalogWorld) { return `${w.source === 'template' ? 'templates' : 'published'}/${w.id}`; }

  private listStarted = 0;

  /** Start the network half of init (the catalog list and the shipped cards); boot runs it alongside SQLite. */
  list(): Promise<{ list: CatalogWorld[]; intros: Awaited<ReturnType<IntroSource>> }> {
    this.listStarted = performance.now();
    // Fetched alongside the list; a missing or broken intros.json only costs the cards their detail.
    const cards = this.intros().catch(() => null);
    return this.catalog.listWorlds().then(async (list) => ({ list, intros: await cards }));
  }

  /** List the catalog (or take a listing started earlier) and write a stub for every world. Call before persistence starts (stubs are base). */
  async init(listing?: Promise<{ list: CatalogWorld[]; intros: Awaited<ReturnType<IntroSource>> }>) {
    const { list, intros } = await (listing ?? this.list());
    const t = this.listStarted;
    for (const w of list) {
      if (w.source === 'draft') continue; // drafts open from the player's own save root, not the shelf
      const key = this.keyOf(w);
      const root = this.root(key);
      if (!/^[a-zA-Z0-9][\w-]*$/.test(w.id)) continue;
      if (fs.existsSync(`${root}/world.json`)) continue; // packed into the image (`?templates=`): the server has it already
      this.worlds.set(key, w);
      const files = new Set<string>(['world.json']);
      fs.mkdirSync(root, { recursive: true });
      const entry = intros?.index.worlds[w.id];
      const world = withIntro(w.world, entry);
      fs.writeFileSync(`${root}/world.json`, JSON.stringify(world, null, 2));
      // Placeholders where the card's portraits are: the server names a portrait URL only for a file it can see.
      const portraitPaths = entry ? introCastPaths(world).filter((p): p is string => !!p && !!entry.avatars[p]) : [];
      for (const rel of [w.cover?.path, w.coverVideo?.path, ...portraitPaths]) {
        if (!rel || files.has(rel)) continue;
        const p = `${root}/${rel}`;
        fs.mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
        fs.writeFileSync(p, new Uint8Array(0));
        files.add(rel);
      }
      if (entry && intros) this.portraits.set(key, { cast: introCastPaths(world), files: entry.avatars, base: intros.avatarBase });
      this.stubs.set(key, files);
    }
    this.stats.listed = this.worlds.size;
    this.stats.listMs = Math.round(performance.now() - t);
    return this.worlds.size;
  }

  /** After the overlay is restored: a published world the player has locally (their own publish) is theirs, not the catalog's. */
  afterRestore() {
    for (const key of this.worlds.keys()) {
      if (!key.startsWith('published/')) { this.onIgnore(this.root(key)); continue; }
      if (this.isLocal(key)) { this.worlds.delete(key); continue; }
      this.onIgnore(this.root(key));
    }
  }

  private isLocal(key: string) {
    const root = this.root(key), stub = this.stubs.get(key) ?? new Set();
    const walk = (d: string, rel: string): boolean => {
      for (const e of fs.readdirSync(d, { withFileTypes: true }) as any[]) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory() ? walk(`${d}/${e.name}`, r) : !stub.has(r)) return true;
      }
      return false;
    };
    try { return walk(root, ''); } catch { return false; }
  }

  /** The catalog key of a load path (`templates/<id>`, `published/<id>`, `worlds/published/<id>`); null for anything else. */
  static keyOfPath(worldPath: string): string | null {
    const m = /^(?:\.\/)?(templates|published|worlds\/published)\/([a-zA-Z0-9][\w-]*)\/?$/.exec(worldPath);
    return m ? `${m[1] === 'templates' ? 'templates' : 'published'}/${m[2]}` : null;
  }

  /**
   * The player opened this world's card: download its files into the blob cache (not the VFS) while they
   * read it, so 「开始新游戏」 finds them there. One prefetch at a time, 4 files in parallel; a newer
   * prefetch or any open stops it. Signed out (storage answers 401) it does nothing.
   */
  async prefetch(worldPath: string): Promise<void> {
    const key = WorldLibrary.keyOfPath(worldPath);
    const w = key ? this.worlds.get(key) : undefined;
    if (!key || !w || this.ready.get(key) === w.hash || this.pending.has(key)) return;
    const gen = ++this.prefetchGen;
    const t = performance.now();
    let bundle;
    try { bundle = await this.catalog.getWorld(w.id, w.revision); } catch { return; }
    const todo = bundle.files.filter((f) => !this.catalog.hasBlob(f.sha256, f.size));
    let next = 0, fetched = 0;
    const lane = async () => {
      while (next < todo.length && gen === this.prefetchGen) {
        const f = todo[next++];
        try { await this.catalog.getBlob(f, { id: w.id, revision: bundle.revision }); fetched++; } catch { return; }
      }
    };
    await Promise.all(Array.from({ length: 4 }, lane));
    this.stats.prefetched.push({ id: w.id, ms: Math.round(performance.now() - t), files: bundle.files.length, fetched, ...(gen !== this.prefetchGen ? { stopped: true } : {}) });
  }

  /** Fetch a world's files into the VFS (once per catalog hash). */
  ensure(key: string): Promise<void> {
    const w = this.worlds.get(key);
    if (!w || this.ready.get(key) === w.hash) return Promise.resolve();
    // An open goes first: a prefetch of this world hands over (shared downloads), one of another world stops.
    this.prefetchGen++;
    let p = this.pending.get(key);
    if (!p) {
      p = this.materialise(key, w).finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return p;
  }

  private async materialise(key: string, w: CatalogWorld) {
    const t = performance.now();
    const bundle = await this.catalog.getWorld(w.id, w.revision);
    let fetched = 0;
    const bodies = new Array<Uint8Array>(bundle.files.length);
    let next = 0;
    const worker = async () => {
      while (next < bundle.files.length) {
        const i = next++;
        const f = bundle.files[i];
        if (!this.catalog.hasBlob(f.sha256, f.size)) fetched++;
        bodies[i] = await this.catalog.getBlob(f, { id: w.id, revision: bundle.revision });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    // Swap in one synchronous step: the server never sees a half-written world.
    const root = this.root(key);
    fs.rmSync(root, { recursive: true, force: true });
    bundle.files.forEach((f, i) => {
      const p = `${root}/${f.path}`;
      fs.mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
      fs.writeFileSync(p, bodies[i]);
    });
    // Materialised for THIS catalog entry (a shipped trial world's bundle hash is not storage's).
    this.ready.set(key, w.hash);
    this.stats.opened.push({ id: w.id, ms: Math.round(performance.now() - t), files: bundle.files.length, fetched });
  }

  /**
   * Requests the library answers or prepares before the in-tab server sees them.
   * Returns a response to send instead, or null to dispatch as usual (after any
   * materialising it needed).
   */
  async intercept(msg: { method: string; url: string; body?: Uint8Array | null }): Promise<Answer | null> {
    const u = new URL(msg.url, 'http://localhost');
    if (msg.method === 'POST' && u.pathname === '/api/worlds/load' && msg.body) {
      let worldPath = '';
      try { worldPath = String(JSON.parse(new TextDecoder().decode(msg.body)).worldPath ?? ''); } catch { return null; }
      const key = WorldLibrary.keyOfPath(worldPath);
      if (key) {
        try { await this.ensure(key); } catch (e) {
          return json(...worldLoadFailure(e));
        }
      }
      return null;
    }
    if (msg.method === 'GET' && u.pathname === '/api/worlds/intro-avatar') {
      // A card's portrait while the world is still a stub: the shipped copy under /world-intros/.
      const id = u.searchParams.get('id') ?? u.searchParams.get('published');
      const key = u.searchParams.has('id') ? `templates/${id}` : `published/${id}`;
      const w = this.worlds.get(key);
      const card = this.portraits.get(key);
      if (!w || !card || this.ready.get(key) === w.hash) return null;
      const rel = card.cast[Number(u.searchParams.get('n'))];
      const name = rel ? card.files[rel] : undefined;
      if (!name) return json(404, { ok: false, code: 'not_found', error: 'No portrait.' });
      try {
        const r = await fetch(new URL(name, card.base).href);
        if (!r.ok) return json(404, { ok: false, code: 'not_found', error: `portrait: ${r.status}` });
        return { status: 200, headers: { 'content-type': TYPES[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'public, max-age=3600' }, body: new Uint8Array(await r.arrayBuffer()) };
      } catch (e) {
        return json(502, { ok: false, code: 'catalog', error: (e as Error).message });
      }
    }
    if (msg.method === 'GET' && u.pathname === '/api/worlds/cover') {
      const id = u.searchParams.get('id') ?? u.searchParams.get('published');
      const key = u.searchParams.has('id') ? `templates/${id}` : u.searchParams.has('published') ? `published/${id}` : null;
      const w = key ? this.worlds.get(key) : undefined;
      if (!key || !w || this.ready.get(key) === w.hash) return null;
      const video = u.searchParams.get('kind') === 'video';
      if (!video && w.coverUrl) {
        try {
          const { bytes, type } = await this.catalog.getPublicImage(w.coverUrl);
          return { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=3600', etag: `"${w.id}@${w.revision}"` }, body: bytes };
        } catch (e) {
          return json(502, { ok: false, code: 'catalog', error: (e as Error).message });
        }
      }
      const file = video ? w.coverVideo : w.cover;
      if (!file) return null;
      try {
        const body = await this.catalog.getImage({ world: w.id, revision: w.revision, file });
        return { status: 200, headers: { 'content-type': TYPES[file.path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'public, max-age=3600', etag: `"${file.sha256}"` }, body };
      } catch (e) {
        return json(502, { ok: false, code: 'catalog', error: (e as Error).message });
      }
    }
    return null;
  }
}

/**
 * A failed world download as the /api/worlds/load answer the page can act on (apps/web lib/world-load-error.ts):
 *   401 signed_out   storage wants an account — the page asks to sign in (the play gate normally does it first);
 *   503 network      no answer from the network — try again;
 *   502 world_files  the bytes that came back are not the world's — try again later / report it.
 * `detail` keeps the catalog's own sentence for the console and bug reports.
 */
export function worldLoadFailure(e: unknown): [number, { code: string; error: string; detail: string; retry: boolean }] {
  const detail = e instanceof Error ? e.message : String(e);
  switch (catalogFailureOf(e)) {
    case 'signed_out': return [401, { code: 'signed_out', error: 'Sign in to your account to open this world.', detail, retry: false }];
    case 'network': return [503, { code: 'network', error: 'Could not reach the world files. Check your connection and try again.', detail, retry: true }];
    default: return [502, { code: 'world_files', error: 'This world’s files did not download correctly. Try again in a moment; if it keeps happening, report a problem.', detail, retry: true }];
  }
}

function json(status: number, v: unknown): Answer {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: new TextEncoder().encode(JSON.stringify(v)) };
}
