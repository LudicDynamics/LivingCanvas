import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { LocalWorldStore } from '@airp/shared';
import { MADE_ID, isOfficialId } from '../world-workshop.js';
import { bundleLimits, buildEntries, extractEntries, readManifestFile, writeManifestFile, type ExtractedBundle } from './bundle.js';
import type { TarEntry } from './tar.js';
import {
  RemoteError,
  call,
  pairOf,
  remoteFailure,
  servicesConfig,
  MAX_REMOTE_COVER_BYTES,
  type RemoteDeps,
  type RemotePair,
  type RemoteWorld,
  type Signed,
} from './remote-client.js';

/**
 * The remote as the Worldlines services
 * a LivingCanvas world is
 * the identity resource `livingcanvas/world/made-xxxxxxxx` (owner, draft /
 * published, one submission at a time through a lease), and its files are one
 * revision in the storage service (worldlines-storage the design notes).
 *
 *   list      identity GET /v1/resources?scope=mine  +  storage GET /v1/public/livingcanvas/worlds
 *   upload    register → lease → storage upload-url → PUT each file → storage complete (commits)
 *   publish   identity publish {revision} (= the resource's published_revision)
 *   unpublish identity unpublish
 *   download  storage download-url (?revision=published for a public world, latest for my own)
 *
 * Every call carries the account's own access token (the session this app
 * already holds, see remote-client.ts); presigned file URLs never do. The files
 * are exactly the bundle's files (bundle.ts: authored content only, no play
 * traces, no tokens), each under a storage-safe name (`storagePath`).
 */

const PRODUCT = 'livingcanvas';
const KIND = 'world';
const LEASE_TTL = 900;
const PARALLEL = 4;

const ref = (id: string) => `${PRODUCT}/${KIND}/${encodeURIComponent(id)}`;
const identityUrl = (rel: string) => `${servicesConfig().identity}${rel}`;
const storageUrl = (rel: string) => `${servicesConfig().storage}${rel}`;
const jsonInit = (method: string, body?: unknown): RequestInit =>
  ({ method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });

async function json<T>(signed: Signed, url: string, init: RequestInit, deps: RemoteDeps): Promise<T> {
  return await (await call(signed, url, init, deps.fetch)).json() as T;
}

/** A plain request (public list, presigned URLs): no account token. */
async function plain(url: string, init: RequestInit, deps: RemoteDeps): Promise<Response> {
  try {
    return await (deps.fetch ?? fetch)(url, { ...init, redirect: init.redirect ?? 'follow', signal: AbortSignal.timeout(10 * 60_000) });
  } catch (error) {
    throw new RemoteError(502, 'remote_unreachable', `The remote could not be reached (${error instanceof Error ? error.name : 'network error'}).`);
  }
}

async function pool<T, R>(items: readonly T[], width: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await run(items[i]); }
  }));
  return out;
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

// ── file names ──────────────────────────────────────────────────────────────
//
// Storage accepts a path segment that starts with a letter, digit or `_` and
// continues with letters, digits, space and `._()+-` (worldlines-storage
// src/layout.mjs). A world has files it refuses: `.airpworld/assets/…` (where
// generated pictures land) and names with other punctuation (「」、・…). Each
// such character becomes `+<hex code point>+`; a segment whose first character
// had to be escaped (or is `_`) gets a leading `_`. Plain names stay as they
// are, so the public catalog still finds `world.json` and the cover.

const FIRST = /^[\p{L}\p{N}]$/u;
const REST = /^[\p{L}\p{N} ._()-]$/u;
const STORAGE_SEGMENT = /^[\p{L}\p{N}_][\p{L}\p{N} ._()+-]{0,199}$/u;

export function encodeSegment(segment: string): string {
  const out = [...segment].map((c, i) => ((i === 0 ? FIRST : REST).test(c) ? c : `+${c.codePointAt(0)!.toString(16)}+`)).join('');
  return out.startsWith('+') ? `_${out}` : out;
}
export function decodeSegment(segment: string): string {
  const body = segment.startsWith('_+') ? segment.slice(1) : segment;
  return body.replace(/\+([0-9a-f]{1,6})\+/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}
/** The storage name of a world path, or null when even escaped it does not fit. */
export function storagePath(rel: string): string | null {
  const encoded = rel.split('/').map(encodeSegment);
  if (encoded.some((s) => !STORAGE_SEGMENT.test(s))) return null;
  const joined = encoded.join('/');
  return Buffer.byteLength(joined) <= 512 ? joined : null;
}
export const worldPathOf = (stored: string) => stored.split('/').map(decodeSegment).join('/');

// ── whoami / list ───────────────────────────────────────────────────────────

export async function whoami(signed: Signed, deps: RemoteDeps) {
  const body = await json<{ user?: { id?: unknown; email?: unknown } }>(signed, identityUrl('/v1/me'), {}, deps);
  if (typeof body.user?.id !== 'string') throw new RemoteError(502, 'remote_error', 'The account service did not say who you are.');
  return { ok: true as const, uid: body.user.id, email: typeof body.user.email === 'string' ? body.user.email : signed.session.email, url: signed.url };
}

interface Resource {
  id: string; status: 'draft' | 'published'; title: string | null; meta: Record<string, unknown>;
  revision: number; published_revision: number | null; hash: string | null; size: number | null;
  owner_id: string; updated_at: string | null; published_at: string | null;
}
interface CatalogWorld {
  id: string; name?: string; description?: string; locale?: string | null; revision?: number; hash?: string; size?: number;
  publisher?: string | null; published_at?: string | null; updated_at?: string | null; cover_url?: string | null;
}

async function myResources(signed: Signed, deps: RemoteDeps): Promise<Resource[]> {
  const out: Resource[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const q: URLSearchParams = new URLSearchParams({ scope: 'mine', product: PRODUCT, kind: KIND, limit: '100', ...(cursor ? { cursor } : {}) });
    const body: { resources?: Resource[]; next_cursor?: string | null } = await json<{ resources?: Resource[]; next_cursor?: string | null }>(signed, identityUrl(`/v1/resources?${q}`), {}, deps);
    out.push(...(body.resources ?? []));
    cursor = body.next_cursor ?? null;
    if (!cursor) break;
  }
  return out;
}

const text = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

/** The remote list in the shape the page already knows (`RemoteWorldList`). */
export async function list(signed: Signed, deps: RemoteDeps): Promise<{ uid: string; admin: boolean; drafts: RemoteWorld[]; public: RemoteWorld[] }> {
  const uid = signed.session.uid;
  const [mine, catalog] = await Promise.all([
    myResources(signed, deps),
    plain(storageUrl('/v1/public/livingcanvas/worlds'), { headers: { accept: 'application/json' } }, deps).then(async (res) => {
      if (!res.ok) throw await remoteFailure(res);
      return ((await res.json()) as { worlds?: CatalogWorld[] }).worlds ?? [];
    }),
  ]);
  const mineIds = new Set(mine.map((r) => r.id));
  // My drafts, and my published worlds that have a newer revision than the public one (republish to show it).
  // Official editions I own are always here: they are the lobby's, so they are not in `public`
  // below, and this is where their owner downloads one to edit and republishes it.
  const drafts = mine
    .filter((r) => r.revision > 0 && ((MADE_ID.test(r.id) && (r.status === 'draft' || (r.published_revision ?? 0) < r.revision)) || isOfficialId(r.id)))
    .map((r): RemoteWorld => ({
      id: r.id,
      name: text(r.meta?.name, r.title ?? r.id),
      description: text(r.meta?.description),
      locale: typeof r.meta?.locale === 'string' ? r.meta.locale : null,
      updatedAt: r.updated_at ?? '',
      size: r.size ?? 0,
      revision: r.revision,
      hash: r.hash,
      status: r.status,
      publishedRevision: r.published_revision,
      owner: uid,
      mine: true,
      ...(isOfficialId(r.id) ? { official: true } : {}),
      coverUrl: `/api/remote/cover?id=${encodeURIComponent(r.id)}&from=tenant&rev=${r.revision}`,
    }));
  // Workshop worlds only: the official ones are the lobby's, not something to download and keep building.
  const shared = catalog.filter((w) => typeof w.id === 'string' && MADE_ID.test(w.id)).map((w): RemoteWorld => ({
    id: w.id,
    name: text(w.name, w.id),
    description: text(w.description),
    locale: w.locale ?? null,
    updatedAt: w.updated_at ?? w.published_at ?? '',
    publishedAt: w.published_at ?? null,
    size: w.size ?? 0,
    revision: w.revision ?? 0,
    hash: w.hash ?? null,
    status: 'published',
    owner: mineIds.has(w.id) ? uid : '',
    mine: mineIds.has(w.id),
    publisher: w.publisher ?? null,
    // Public, cacheable, CORP cross-origin: the page loads it straight from storage.
    coverUrl: typeof w.cover_url === 'string' && /^https?:\/\//.test(w.cover_url) ? w.cover_url : null,
  }));
  return { uid, admin: false, drafts, public: shared };
}

// ── download ────────────────────────────────────────────────────────────────

interface DownloadAnswer { revision: number; hash: string; published_revision: number | null; files: { path: string; size: number; sha256: string; url: string }[] }

async function downloadUrl(signed: Signed, id: string, from: 'tenant' | 'public', rev: number | null, deps: RemoteDeps): Promise<DownloadAnswer> {
  const q = from === 'public' ? '?revision=published' : rev ? `?revision=${rev}` : '';
  return json<DownloadAnswer>(signed, storageUrl(`/v1/objects/${ref(id)}/download-url${q}`), {}, deps);
}

async function fetchFile(file: { path: string; size: number; sha256: string; url: string }, deps: RemoteDeps): Promise<Buffer> {
  const res = await plain(file.url, {}, deps);
  if (!res.ok) throw new RemoteError(502, 'remote_error', `A file of this world could not be downloaded (HTTP ${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length !== file.size || sha256(data) !== file.sha256) throw new RemoteError(502, 'integrity_mismatch', `A downloaded file does not match what the remote recorded: ${file.path}.`);
  return data;
}

/** Fetch one revision's files (each checked against its SHA-256) and stage them as a world under `root`. */
export async function download(signed: Signed, input: { id: string; from: 'tenant' | 'public'; root: string }, deps: RemoteDeps): Promise<{ revision: number; extracted: ExtractedBundle }> {
  const answer = await downloadUrl(signed, input.id, input.from, null, deps);
  const limits = bundleLimits();
  const files = answer.files ?? [];
  const total = files.reduce((n, f) => n + f.size, 0);
  if (files.length > limits.maxFiles || total > limits.maxTotalBytes || files.some((f) => f.size > limits.maxFileBytes)) {
    throw new RemoteError(413, 'too_large', 'This world is larger than this computer accepts.');
  }
  const entries: TarEntry[] = await pool(files, PARALLEL, async (f) => ({ path: worldPathOf(f.path), data: await fetchFile(f, deps) }));
  return { revision: answer.revision, extracted: await extractEntries(entries, input.root, answer.hash, { official: isOfficialId(input.id) }) };
}

// ── cover ───────────────────────────────────────────────────────────────────

const COVER_TYPE: Record<string, string> = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.avif': 'image/avif' };

/** My draft's cover (the public ones are loaded from storage directly): world.json → its `cover` file. */
export async function cover(signed: Signed, input: { id: string; from: 'tenant' | 'public'; rev: number | null }, deps: RemoteDeps): Promise<{ bytes: Buffer; type: string; pinned: boolean }> {
  if (input.from === 'public') {
    const res = await plain(storageUrl(`/v1/public/livingcanvas/worlds/${encodeURIComponent(input.id)}/cover`), { headers: { accept: 'image/*' } }, deps);
    if (!res.ok) throw await remoteFailure(res);
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!Object.values(COVER_TYPE).includes(type) || bytes.length > MAX_REMOTE_COVER_BYTES) throw new RemoteError(502, 'remote_error', 'The remote did not send a picture.');
    return { bytes, type, pinned: false };
  }
  const answer = await downloadUrl(signed, input.id, 'tenant', input.rev, deps);
  const manifestFile = answer.files.find((f) => f.path === 'world.json');
  if (!manifestFile) throw new RemoteError(404, 'not_found', 'This world has no cover.');
  let coverPath: unknown;
  try { coverPath = (JSON.parse((await fetchFile(manifestFile, deps)).toString('utf8')) as { cover?: unknown }).cover; } catch (e) { if (e instanceof RemoteError) throw e; }
  const stored = typeof coverPath === 'string' ? storagePath(coverPath.replace(/^\.?\//, '')) : null;
  const file = stored ? answer.files.find((f) => f.path === stored) : undefined;
  const type = file ? COVER_TYPE[path.extname(file.path).toLowerCase()] : undefined;
  if (!file || !type || file.size > MAX_REMOTE_COVER_BYTES) throw new RemoteError(404, 'not_found', 'This world has no cover.');
  // A numbered revision never changes: the page may keep it.
  return { bytes: await fetchFile(file, deps), type, pinned: input.rev !== null && input.rev === answer.revision };
}

// ── upload / publish ────────────────────────────────────────────────────────

const isFailure = (e: unknown, status: number, code?: string) => e instanceof RemoteError && e.status === status && (code === undefined || e.code === code);
const newMadeId = () => `made-${randomUUID().replace(/-/g, '').slice(0, 8)}`;

/** What the public catalog and my list show before anyone downloads the world. */
function metaOf(manifest: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  if (typeof manifest.name === 'string') meta.name = manifest.name.slice(0, 200);
  if (typeof manifest.description === 'string') meta.description = manifest.description.slice(0, 1000);
  if (typeof manifest.locale === 'string') meta.locale = manifest.locale;
  if (typeof manifest.cover === 'string') { const c = storagePath(manifest.cover.replace(/^\.?\//, '')); if (c) meta.cover = c; }
  return meta;
}

/** Is `livingcanvas/world/<id>` mine? (identity's view says `mine`; someone else's draft is a 404 → false.) */
export async function owns(signed: Signed, id: string, deps: RemoteDeps): Promise<boolean> {
  try {
    return (await json<{ resource?: { mine?: boolean } }>(signed, identityUrl(`/v1/resources/${ref(id)}`), {}, deps)).resource?.mine === true;
  } catch (e) {
    if (isFailure(e, 404)) return false;
    throw e;
  }
}

/** 「上传到我的远端草稿」: one new revision of `livingcanvas/world/<id>` holding the world's authored files. */
export async function push(signed: Signed, input: { dir: string; manifest: Record<string, unknown>; store: LocalWorldStore | null }, deps: RemoteDeps) {
  const pair = pairOf(input.manifest);
  const wanted = pair && pair.url === signed.url ? pair.id : String(input.manifest.id);
  // An official edition goes back under its own id, as the edition it is: never renamed, never created here (the
  // release script registers editions with their public byline), and without this computer's workshop block —
  // every player's copy of it starts from these files, and a workshop block would make each of them its "author".
  const official = isOfficialId(wanted);
  if (official) {
    try {
      await json(signed, identityUrl(`/v1/resources/${ref(wanted)}`), {}, deps);
    } catch (e) {
      if (isFailure(e, 404)) throw new RemoteError(404, 'not_found', 'This official world is not on the remote.');
      throw e;
    }
  }
  const built = await buildEntries(input.dir, { store: input.store, ...(official ? { manifest: ({ workshop: _local, ...rest }: Record<string, unknown>) => rest } : {}) });
  const skipped = [...built.skipped];
  const worldJson = built.entries.find((e) => e.path === 'world.json');
  if (!worldJson) throw new RemoteError(422, 'invalid_world', 'This world has no world.json.');
  const manifest = JSON.parse(worldJson.data.toString('utf8')) as Record<string, unknown>;

  // The id is the world's; one that is someone else's gets a new one (as the legacy remote renamed on a collision).
  let id = wanted;
  let created = false;
  for (let attempt = 0; ; attempt++) {
    try {
      const body = { product: PRODUCT, kind: KIND, id, title: String(manifest.name ?? id).slice(0, 200), meta: metaOf(manifest) };
      created = (await json<{ created?: boolean }>(signed, identityUrl('/v1/resources'), jsonInit('POST', body), deps)).created === true;
      break;
    } catch (e) {
      if (official && isFailure(e, 409, 'owned')) throw new RemoteError(403, 'not_owner', 'This official world belongs to another account.');
      if (!isFailure(e, 409, 'owned') || attempt >= 3) throw e;
      id = newMadeId();
    }
  }
  if (id !== manifest.id) worldJson.data = Buffer.from(JSON.stringify({ ...manifest, id }, null, 2) + '\n');

  const files: { path: string; size: number; sha256: string; data: Buffer }[] = [];
  for (const entry of built.entries) {
    const stored = storagePath(entry.path);
    if (!stored) { skipped.push(entry.path); continue; }
    files.push({ path: stored, size: entry.data.length, sha256: sha256(entry.data), data: entry.data });
  }
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.path.toLowerCase())) throw new RemoteError(400, 'bad_path', `Two files differ only in upper / lower case: ${worldPathOf(f.path)}. Rename one.`);
    seen.add(f.path.toLowerCase());
  }

  const lease = await json<{ lease_id: string }>(signed, identityUrl(`/v1/resources/${ref(id)}/lease`), jsonInit('POST', { ttlSeconds: LEASE_TTL }), deps);
  let done: { resource?: { revision?: number; hash?: string }; manifest?: { revision: number; hash: string; size: number }; quota?: unknown };
  try {
    const up = await json<{ revision: number; uploads: { path: string; url: string; method?: string; headers?: Record<string, string> }[] }>(
      signed, storageUrl(`/v1/objects/${ref(id)}/upload-url`), jsonInit('POST', { leaseId: lease.lease_id, files: files.map(({ path: p, size, sha256: h }) => ({ path: p, size, sha256: h })) }), deps);
    const byPath = new Map(files.map((f) => [f.path, f]));
    await pool(up.uploads, PARALLEL, async (u) => {
      const file = byPath.get(u.path);
      if (!file) throw new RemoteError(502, 'remote_error', 'The remote asked for a file this world does not have.');
      // fetch sets Content-Length itself; every other signed header goes as given.
      const headers = Object.fromEntries(Object.entries(u.headers ?? {}).filter(([k]) => k.toLowerCase() !== 'content-length'));
      const res = await plain(u.url, { method: u.method ?? 'PUT', headers, body: new Uint8Array(file.data), redirect: 'error' }, deps);
      if (!res.ok) throw new RemoteError(502, 'upload_failed', `A file could not be uploaded (HTTP ${res.status}). Try again.`);
      await res.body?.cancel().catch(() => {});
    });
    done = await json(signed, storageUrl(`/v1/objects/${ref(id)}/complete`), jsonInit('POST', { leaseId: lease.lease_id, revision: up.revision }), deps);
  } catch (error) {
    // Nothing committed: give the world back (best effort; the lease also expires on its own).
    await call(signed, identityUrl(`/v1/resources/${ref(id)}/lease/${encodeURIComponent(lease.lease_id)}`), { method: 'DELETE' }, deps.fetch).catch(() => {});
    throw error;
  }
  const revision = done.manifest?.revision ?? done.resource?.revision ?? 0;
  const hash = done.manifest?.hash ?? done.resource?.hash ?? '';
  const next: RemotePair = { url: signed.url, id, revision, hash, from: 'tenant', syncedAt: new Date().toISOString() };
  // Re-read: the world may have changed while the files were on the wire; only the pair is written.
  const fresh = await readManifestFile(input.dir) ?? input.manifest;
  await writeManifestFile(input.dir, { ...fresh, remote: next });
  return { ok: true as const, id, revision, hash, replaced: !created && revision > 1, renamed: id !== wanted, files: files.length, bytes: built.bytes, skipped, quota: quotaNotice(done.quota) };
}

/** Storage's quota summary on complete → what the page shows: null unless usage is near the plan's limit (≥ warn_pct). */
export function quotaNotice(raw: unknown): { plan: string; bytesPercent: number | null; countPercent: number | null; warnings: string[] } | null {
  const q = raw as { plan?: unknown; warnings?: unknown; total?: { percent?: unknown } | null; kind?: { percent?: unknown } | null } | null;
  const warnings = Array.isArray(q?.warnings) ? q.warnings.filter((w): w is string => typeof w === 'string') : [];
  if (!q || !warnings.length) return null;
  const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  return { plan: typeof q.plan === 'string' ? q.plan : 'free', bytesPercent: pct(q.total?.percent), countPercent: pct(q.kind?.percent), warnings };
}

/** 在远端发布: the latest committed revision becomes the public one. */
export async function publish(signed: Signed, id: string, deps: RemoteDeps) {
  const current = (await json<{ resource: Resource }>(signed, identityUrl(`/v1/resources/${ref(id)}`), {}, deps)).resource;
  if (!current.revision) throw new RemoteError(409, 'no_content', 'Upload this world before publishing it.');
  const r = (await json<{ resource: Resource }>(signed, identityUrl(`/v1/resources/${ref(id)}/publish`), jsonInit('POST', { revision: current.revision }), deps)).resource;
  return { ok: true as const, id, publishedAt: r.published_at, revision: r.published_revision ?? r.revision };
}

/** 撤回发布: back to a draft only its owner sees. Not public (or not there) → `not_public`. */
export async function unpublish(signed: Signed, id: string, deps: RemoteDeps) {
  let answer: { changed?: boolean };
  try {
    answer = await json(signed, identityUrl(`/v1/resources/${ref(id)}/unpublish`), jsonInit('POST', {}), deps);
  } catch (e) {
    if (isFailure(e, 404)) throw new RemoteError(404, 'not_public', 'This world is not public on the remote.');
    throw e;
  }
  if (answer.changed === false) throw new RemoteError(404, 'not_public', 'This world is not public on the remote.');
  return { ok: true as const, id, status: 'draft' as const };
}
