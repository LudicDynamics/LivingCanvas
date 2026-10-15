import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isTenantId, publishedRoot, tenantWorldsRoot } from '../engine/user-root.js';
import { MADE_ID, workshopOf, type TakenDown, type WorkshopMeta } from '../world-workshop.js';
import { coverOf } from '../world-shelf.js';
import { fileHash } from '../asset-hash.js';
import {
  BUNDLE_TYPE,
  BundleError,
  authoredFiles,
  buildBundle,
  cleanCopy,
  copyTree,
  extractBundle,
  readManifestFile,
  stripPairing,
  trashDir,
  writeManifestFile,
  type BuiltBundle,
  type ExtractedBundle,
} from './bundle.js';
import {
  BUSY_MESSAGE,
  KIND,
  LEASE_TTL,
  getOrNull,
  isIdentityError,
  listAll,
  registerOnFirstSight,
  resourcesFor,
  tenancy,
  type Resource,
  type ResourcesClient,
} from './resources.js';

/**
 * The hosted side of sync: tenants and the
 * public area.
 *
 * - A TENANT is one signed-in user's save root (`tenantWorldsRoot`), the same
 *   directory their hosted seat plays in. Sync reads and writes only the
 *   workshop ORIGINALS there (`made-xxxxxxxx`, id = directory name, owned by
 *   that uid) — never play copies, never another user's root.
 * - The PUBLIC area is `publishedRoot`, shared by every user: any signed-in user
 *   may list and download from it, only the owner of a world may
 *   replace or retire it.
 * - The rule the team set (2026-09-28): a tenant keeps only what is NOT published.
 *   Publishing through sync MOVES the draft out of the tenant into the public
 *   area; unpublishing moves it back.
 * - WHO owns a world id, whether it is published, and who may submit to it
 *   right now is decided by the Worldlines identity service when it is
 *   configured (`resources.ts`); the files stay here. Without it (local
 *   `pnpm dev`) the in-process rules below decide, as before.
 */

export interface SyncMeta { revision: number; hash: string | null; uploadedAt?: string }

export interface SyncWorld {
  id: string;
  name: string;
  description: string;
  locale: string | null;
  updatedAt: string;
  /** Bytes of the files that would travel in a bundle. */
  size: number;
  revision: number;
  hash: string | null;
  status: WorkshopMeta['status'];
  owner: string;
  mine: boolean;
  /** Only on the author's own draft: an admin took it out of the public area. */
  takenDown?: TakenDown;
  /**
   * The cover picture, if any: its content hash and
   * size. Fetched from `GET /api/sync/worlds/:id/cover?from=…&h=<hash>` under the
   * same rules as the bundle — a draft by its owner only, a public world by anyone
   * signed in.
   */
  cover: { hash: string; bytes: number; type: string } | null;
}

const COVER_TYPES: Record<string, string> = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.avif': 'image/avif' };

/** The cover file of a world directory (never outside it), or null. */
export async function coverFileOf(dir: string, manifest: Record<string, unknown>): Promise<{ file: string; type: string } | null> {
  const rel = await coverOf(dir, manifest);
  if (!rel) return null;
  const root = await fs.realpath(dir).catch(() => null);
  const file = root ? await fs.realpath(path.join(dir, rel)).catch(() => null) : null;
  const type = file ? COVER_TYPES[path.extname(file).toLowerCase()] : undefined;
  if (!root || !file || !type || !file.startsWith(root + path.sep)) return null;
  return { file, type };
}

async function coverMeta(dir: string, manifest: Record<string, unknown>): Promise<SyncWorld['cover']> {
  const found = await coverFileOf(dir, manifest);
  if (!found) return null;
  const [hash, stat] = await Promise.all([fileHash(found.file), fs.stat(found.file).catch(() => null)]);
  return hash && stat ? { hash, bytes: stat.size, type: found.type } : null;
}

export function syncMetaOf(manifest: Record<string, unknown> | null | undefined): SyncMeta {
  const raw = manifest?.sync as Partial<SyncMeta> | undefined;
  return {
    revision: typeof raw?.revision === 'number' && Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
    hash: typeof raw?.hash === 'string' ? raw.hash : null,
    ...(typeof raw?.uploadedAt === 'string' ? { uploadedAt: raw.uploadedAt } : {}),
  };
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

async function describe(dir: string, id: string, manifest: Record<string, unknown>, meta: WorkshopMeta, uid: string): Promise<SyncWorld> {
  const { files } = await authoredFiles(dir);
  const sync = syncMetaOf(manifest);
  const mtime = await fs.stat(path.join(dir, 'world.json')).then((s) => s.mtime.toISOString(), () => '');
  return {
    id,
    name: text(manifest.name) || id,
    description: text(manifest.description),
    locale: text(manifest.locale) || null,
    updatedAt: text(manifest.updatedAt) || mtime,
    size: files.reduce((sum, file) => sum + file.size, 0),
    revision: sync.revision,
    hash: sync.hash,
    status: meta.status,
    owner: meta.owner,
    mine: meta.owner === uid,
    ...(meta.takenDown && meta.owner === uid ? { takenDown: meta.takenDown } : {}),
    cover: await coverMeta(dir, manifest),
  };
}

/** Workshop originals directly under `root`: `made-` id, id = directory name. */
async function originals(root: string): Promise<{ id: string; dir: string; manifest: Record<string, unknown>; meta: WorkshopMeta }[]> {
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of dirs) {
    if (!entry.isDirectory() || !MADE_ID.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    const manifest = await readManifestFile(dir);
    const meta = workshopOf(manifest);
    if (!manifest || !meta || manifest.id !== entry.name) continue;
    out.push({ id: entry.name, dir, manifest, meta });
  }
  return out;
}

/** A uid the identity service can act for (an account, never `local` or a guest). */
const accountUid = (uid: unknown): uid is string => isTenantId(uid) && uid !== 'local' && !uid.startsWith('anon-');

/**
 * The service's record of a PUBLIC world, registering it on first sight as the
 * manifest's owner (a world a seat published straight into the public area,
 * or one that predates the service). null = the service will not vouch for it
 * (the id is someone else's draft, or its owner is unknown there).
 */
async function publicRecord(client: ResourcesClient, known: Resource | null | undefined, id: string, manifest: Record<string, unknown>, meta: WorkshopMeta): Promise<Resource | null> {
  if (known) return known.status === 'published' ? known : null;
  if (!accountUid(meta.owner)) return null;
  try {
    const owner = resourcesFor(meta.owner)!;
    const r = await registerOnFirstSight(owner, id, { title: text(manifest.name), published: true });
    return r && r.status === 'published' ? r : null;
  } catch (err) {
    // The owner never signed in to the service, or the record is locked right now: not vouched for (yet).
    if (isIdentityError(err) && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429) {
      console.warn(`[Sync] public world ${id} not registered (${err.code}); run tools/backfill-livingcanvas-resources.mjs`);
      return null;
    }
    throw err;
  }
}

/** The caller's drafts and the whole public area. */
export async function listSyncWorlds(repoRoot: string, uid: string): Promise<{ uid: string; drafts: SyncWorld[]; public: SyncWorld[] }> {
  const client = resourcesFor(uid);
  const tenant = tenantWorldsRoot(repoRoot, uid);
  const byTime = (a: SyncWorld, b: SyncWorld) => b.updatedAt.localeCompare(a.updatedAt);
  if (!client) {
    const drafts = await Promise.all((await originals(tenant)).filter((w) => w.meta.owner === uid).map((w) => describe(w.dir, w.id, w.manifest, w.meta, uid)));
    const shared = await Promise.all((await originals(publishedRoot(repoRoot))).map((w) => describe(w.dir, w.id, w.manifest, { ...w.meta, status: 'published' }, uid)));
    return { uid, drafts: drafts.sort(byTime), public: shared.sort(byTime) };
  }
  // The files say what exists; the service says whose it is and whether it is public.
  return tenancy(async () => {
    const [mine, pub] = await Promise.all([listAll(client, 'mine'), listAll(client, 'public')]);
    const mineById = new Map(mine.map((r) => [r.id, r]));
    const pubById = new Map(pub.map((r) => [r.id, r]));
    const drafts: SyncWorld[] = [];
    for (const w of await originals(tenant)) {
      if (w.meta.owner !== uid) continue;
      // Register on first sight; an id someone else already holds is not listed (it is re-id'd on its next upload).
      const record = mineById.get(w.id) ?? await registerOnFirstSight(client, w.id, { title: text(w.manifest.name) });
      if (!record?.mine) continue;
      drafts.push(await describe(w.dir, w.id, w.manifest, { ...w.meta, status: 'draft', owner: uid }, uid));
    }
    const shared: SyncWorld[] = [];
    for (const w of await originals(publishedRoot(repoRoot))) {
      const record = await publicRecord(client, pubById.get(w.id), w.id, w.manifest, w.meta);
      if (!record) continue;
      shared.push(await describe(w.dir, w.id, w.manifest, { ...w.meta, status: 'published', owner: record.owner_id }, uid));
    }
    return { uid, drafts: drafts.sort(byTime), public: shared.sort(byTime) };
  });
}

async function tenantOriginal(repoRoot: string, uid: string, id: unknown) {
  if (typeof id !== 'string' || !MADE_ID.test(id)) throw new BundleError(400, 'invalid_argument', 'Expected a world id (made-xxxxxxxx).');
  const dir = path.join(tenantWorldsRoot(repoRoot, uid), id);
  const manifest = await readManifestFile(dir);
  const meta = workshopOf(manifest);
  // Another user's id and a missing id look the same: not found in YOUR tenant.
  if (!manifest || !meta || manifest.id !== id || meta.owner !== uid) throw noDraft();
  return { dir, manifest, meta };
}
const noDraft = () => new BundleError(404, 'not_found', 'No such draft in your remote space.');
const noPublic = () => new BundleError(404, 'not_found', 'No such public world.');

async function publicWorld(repoRoot: string, id: unknown) {
  if (typeof id !== 'string' || !MADE_ID.test(id)) throw new BundleError(400, 'invalid_argument', 'Expected a world id (made-xxxxxxxx).');
  const dir = path.join(publishedRoot(repoRoot), id);
  const manifest = await readManifestFile(dir);
  const meta = workshopOf(manifest);
  if (!manifest || !meta || manifest.id !== id) throw noPublic();
  return { dir, manifest, meta };
}

/** The caller's own record of a tenant draft (registered on first sight), or 404. */
async function ownRecord(client: ResourcesClient, id: string, manifest: Record<string, unknown>): Promise<Resource> {
  const record = await tenancy(async () => (await getOrNull(client, id)) ?? await registerOnFirstSight(client, id, { title: text(manifest.name) }));
  if (!record?.mine) throw noDraft();
  return record;
}

/** The bundle of one of the caller's drafts, or of a public world. */
export async function bundleForDownload(repoRoot: string, uid: string, id: unknown, from: unknown): Promise<BuiltBundle & { revision: number; from: 'tenant' | 'public' }> {
  const scope = from === 'public' ? 'public' : 'tenant';
  const world = scope === 'public' ? await publicWorld(repoRoot, id) : await tenantOriginal(repoRoot, uid, id);
  const client = resourcesFor(uid);
  if (client) {
    // The files are not the authority on who may read them: the service is.
    const worldId = String(world.manifest.id);
    if (scope === 'tenant') await ownRecord(client, worldId, world.manifest);
    else if (!await tenancy(async () => publicRecord(client, await getOrNull(client, worldId), worldId, world.manifest, world.meta))) throw noPublic();
  }
  const built = await buildBundle(world.dir);
  return { ...built, revision: syncMetaOf(world.manifest).revision, from: scope };
}

/**
 * The cover of one of the caller's drafts, or of a public world — exactly the
 * reads `bundleForDownload` allows, checked the same way.
 */
export async function coverForDownload(repoRoot: string, uid: string, id: unknown, from: unknown): Promise<{ file: string; type: string; hash: string | null }> {
  const scope = from === 'public' ? 'public' : 'tenant';
  const world = scope === 'public' ? await publicWorld(repoRoot, id) : await tenantOriginal(repoRoot, uid, id);
  const client = resourcesFor(uid);
  if (client) {
    const worldId = String(world.manifest.id);
    if (scope === 'tenant') await ownRecord(client, worldId, world.manifest);
    else if (!await tenancy(async () => publicRecord(client, await getOrNull(client, worldId), worldId, world.manifest, world.meta))) throw noPublic();
  }
  const found = await coverFileOf(world.dir, world.manifest);
  if (!found) throw new BundleError(404, 'not_found', 'This world has no cover.');
  return { ...found, hash: await fileHash(found.file) };
}

/** Fallback mode only: one sync write per user at a time, so two uploads of the same draft never interleave their renames. */
const locks = new Map<string, Promise<unknown>>();
export function withUserLock<T>(uid: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(uid) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(run);
  const tail = next.catch(() => {});
  locks.set(uid, tail);
  void tail.then(() => { if (locks.get(uid) === tail) locks.delete(uid); });
  return next;
}

/**
 * one submission per WORLD at a time.
 * An upload, publish or unpublish holds its world id for as long as it runs;
 * a second one for the same id — from the same user or anyone else — is
 * answered 409 `busy` at once. It is not queued: a queued upload would land
 * on top of the first one a moment later and silently discard it, which is a
 * merge by another name.
 *
 * With the identity service configured this is its lease (`resources.ts`);
 * the in-process set below is the FALLBACK for a single process without it
 * (local `pnpm dev`).
 */
const inFlight = new Set<string>();
export interface WorldClaims { take(id: string): void; release(): void }
export function worldClaims(): WorldClaims {
  const mine = new Set<string>();
  return {
    take(id) {
      if (mine.has(id)) return;
      if (inFlight.has(id)) throw new BundleError(409, 'busy', BUSY_MESSAGE);
      inFlight.add(id);
      mine.add(id);
    },
    release() {
      for (const id of mine) inFlight.delete(id);
      mine.clear();
    },
  };
}

/** Every user who has a save root here, for the one-owner-per-id rule. */
async function tenantIds(repoRoot: string): Promise<string[]> {
  const declared = (process.env.AIRP_TENANTS_ROOT ?? '').trim();
  const listed = async (dir: string) => (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && isTenantId(e.name)).map((e) => e.name);
  if (declared) return listed(path.resolve(declared));
  return ['local', ...await listed(path.join(repoRoot, 'worlds', 'users'))];
}

/**
 * Does some OTHER user's tenant hold a world with this id? A world id belongs
 * to exactly one tenant, its owner's: an
 * upload that names an id someone else holds gets a fresh id instead — it is
 * never written into, next to, or over the other owner's world.
 *
 * With the identity service this is decided by `register` (409 owned); the
 * disk scan stays as an extra check until every existing world is registered
 * (tools/backfill-livingcanvas-resources.mjs).
 */
async function heldByAnotherTenant(repoRoot: string, uid: string, id: string): Promise<boolean> {
  const own = path.resolve(tenantWorldsRoot(repoRoot, uid));
  for (const other of await tenantIds(repoRoot)) {
    if (other === uid) continue;
    const root = path.resolve(tenantWorldsRoot(repoRoot, other));
    if (root === own) continue;
    if (await fs.lstat(path.join(root, id)).then(() => true, () => false)) return true;
  }
  return false;
}

/** Is `id` someone else's on disk — public under another author, a foreign copy in this tenant, or in another tenant? */
async function takenOnDisk(repoRoot: string, uid: string, id: string): Promise<boolean> {
  const pub = workshopOf(await readManifestFile(path.join(publishedRoot(repoRoot), id)));
  if (pub && pub.owner !== uid) return true;
  const own = await readManifestFile(path.join(tenantWorldsRoot(repoRoot, uid), id));
  if (own !== null && (own.id !== id || workshopOf(own)?.owner !== uid)) return true;
  return heldByAnotherTenant(repoRoot, uid, id);
}

const newMadeId = () => `made-${randomUUID().replace(/-/g, '').slice(0, 8)}`;

/** The upload body, or a reader for it (the route reads it only once the world is held). */
export type UploadBody = Buffer | (() => Promise<Buffer>);
async function readBody(body: UploadBody): Promise<Buffer> {
  const buf = Buffer.isBuffer(body) ? body : await body();
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new BundleError(400, 'bad_bundle', `Send the bundle as the ${BUNDLE_TYPE} body.`);
  return buf;
}

export interface UploadResult { ok: true; id: string; revision: number; hash: string; files: number; bytes: number; replaced: boolean; renamed: boolean }

/** Write an extracted bundle into the tenant as draft `id` (the caller holds the world). */
async function placeDraft(tenant: string, uid: string, extracted: ExtractedBundle, id: string, revision: number): Promise<UploadResult> {
  const renamed = id !== extracted.manifest.id;
  const meta = workshopOf(extracted.manifest)!;
  const now = new Date().toISOString();
  const { publishedAt: _dropped, ...draftMeta } = meta;
  await writeManifestFile(extracted.dir, {
    ...stripPairing(extracted.manifest),
    id,
    workshop: { ...draftMeta, status: 'draft', owner: uid },
    sync: { revision, hash: extracted.hash, uploadedAt: now },
    updatedAt: now,
  });
  const replaced = await trashDir(tenant, id);
  await fs.rename(extracted.dir, path.join(tenant, id));
  return { ok: true, id, revision, hash: extracted.hash, files: extracted.files, bytes: extracted.bytes, replaced, renamed };
}

/**
 * Upload a bundle into the caller's tenant as a DRAFT.
 *
 * The target id is `requestedId` (what the uploader's pair remembers) or the
 * bundle's own id. Same user, same id → a new revision REPLACING the old
 * draft wholesale (the old one goes to the tenant's `.trash`); two versions
 * are never merged. An id that belongs to SOMEONE ELSE — public under another
 * author, or held in another user's tenant — gets a fresh id: a world id has
 * exactly one owner, and nobody may shadow or overwrite another author's world.
 *
 * A requested id is held BEFORE the body is read (`body` may be a reader), so
 * a second upload of it is refused at once instead of racing the first
 * through a 200 MB transfer. Held = the identity service's lease when it is
 * configured (`uploadViaService`), else the in-process `worldClaims`.
 */
export async function uploadToTenant(repoRoot: string, uid: string, body: UploadBody, requestedId?: unknown, claims?: WorldClaims): Promise<UploadResult> {
  const requested = typeof requestedId === 'string' && MADE_ID.test(requestedId) ? requestedId : null;
  const client = resourcesFor(uid);
  if (client) return uploadViaService(repoRoot, uid, client, body, requested);
  const held = claims ?? worldClaims();
  try {
    if (requested) held.take(requested);
    const bundle = await readBody(body);
    const tenant = tenantWorldsRoot(repoRoot, uid);
    await fs.mkdir(tenant, { recursive: true });
    const extracted = await extractBundle(bundle, tenant);
    try {
      return await withUserLock(uid, async () => {
        const wanted = requested ?? String(extracted.manifest.id);
        held.take(wanted);
        let id = wanted;
        while (await takenOnDisk(repoRoot, uid, id)) id = newMadeId();
        held.take(id);
        const previous = await readManifestFile(path.join(tenant, id));
        return placeDraft(tenant, uid, extracted, id, syncMetaOf(previous).revision + 1);
      });
    } finally {
      await fs.rm(extracted.dir, { recursive: true, force: true });
    }
  } finally {
    if (!claims) held.release();
  }
}

/**
 * The id this user may write: `wanted` if it is theirs (registered now if the
 * service had never seen it), else a fresh one. `409 owned` = someone else's.
 */
async function claimId(repoRoot: string, uid: string, client: ResourcesClient, wanted: string, title?: string): Promise<string> {
  let id = wanted;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!await takenOnDisk(repoRoot, uid, id) && await tenancy(() => registerOnFirstSight(client, id, { title }))) return id;
    id = newMadeId();
  }
  throw new BundleError(503, 'tenancy_unavailable', 'Could not find a free world id. Try again.');
}

/**
 * The upload under the identity service: register (a foreign id → a new id),
 * lease (TTL 900 s; another live lease → 409 busy), then — holding it —
 * extract, write the manifest (revision = the service's + 1), trash the old
 * draft, rename into place, and commit. Any failure releases the lease
 * (`withLease`). An unreachable service fails closed (503): nothing is written
 * without a lease.
 */
async function uploadViaService(repoRoot: string, uid: string, client: ResourcesClient, body: UploadBody, requested: string | null): Promise<UploadResult> {
  const tenant = tenantWorldsRoot(repoRoot, uid);
  const staged: { extracted: ExtractedBundle | null } = { extracted: null };
  const extract = async () => {
    const bundle = await readBody(body);
    await fs.mkdir(tenant, { recursive: true });
    staged.extracted = await extractBundle(bundle, tenant);
    return staged.extracted;
  };
  try {
    // No ?id=: the id is only known from the bundle, so it is read first.
    const early = requested ? null : await extract();
    const id = await claimId(repoRoot, uid, client, requested ?? String(early!.manifest.id), early ? text(early.manifest.name) || undefined : undefined);
    return await tenancy(() => client.withLease(KIND, id, async (lease) => {
      const extracted = early ?? await extract();
      const previous = await readManifestFile(path.join(tenant, id));
      const record = await getOrNull(client, id);
      // Nobody else can commit while this lease is held, so + 1 cannot conflict. The disk
      // revision counts too: a world uploaded before the service knew it keeps counting up.
      const revision = Math.max(record?.revision ?? 0, syncMetaOf(previous).revision) + 1;
      const result = await placeDraft(tenant, uid, extracted, id, revision);
      await lease.commit({ revision, hash: extracted.hash, size: extracted.bytes, meta: { files: extracted.files } });
      return result;
    }, { ttlSeconds: LEASE_TTL }));
  } finally {
    if (staged.extracted) await fs.rm(staged.extracted.dir, { recursive: true, force: true });
  }
}

/** Fallback mode: run `work` holding world `id` (one submission per world at a time). */
async function holdingWorld<T>(id: unknown, work: () => Promise<T>): Promise<T> {
  if (typeof id !== 'string' || !MADE_ID.test(id)) throw new BundleError(400, 'invalid_argument', 'Expected a world id (made-xxxxxxxx).');
  const held = worldClaims();
  held.take(id);
  try { return await work(); } finally { held.release(); }
}

/** Copy the clean draft to the public area as `worldId` (staging → rename). */
async function copyToPublic(repoRoot: string, uid: string, draft: { dir: string; manifest: Record<string, unknown>; meta: WorkshopMeta }, worldId: string, publishedAt: string): Promise<void> {
  const root = publishedRoot(repoRoot);
  await fs.mkdir(root, { recursive: true });
  const staging = path.join(root, `.staging-${worldId}-${randomUUID()}`);
  const copy = await cleanCopy(draft.dir);
  try {
    await copyTree(copy.dir, staging);
    await writeManifestFile(staging, {
      ...draft.manifest,
      workshop: { ...withoutTakedown(draft.meta), status: 'published', owner: uid, publishedAt },
      updatedAt: publishedAt,
    });
    await trashDir(root, worldId);
    await fs.rename(staging, path.join(root, worldId));
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    await copy.dispose();
  }
}

/** A draft published again leaves the old takedown note behind. */
function withoutTakedown(meta: WorkshopMeta): WorkshopMeta {
  const { takenDown: _cleared, ...rest } = meta;
  return rest;
}

/** A public copy under another author is never replaced (with the service: a leftover from before it). */
async function refuseForeignPublic(repoRoot: string, uid: string, worldId: string): Promise<void> {
  const existing = workshopOf(await readManifestFile(path.join(publishedRoot(repoRoot), worldId)));
  if (existing && existing.owner !== uid) throw new BundleError(409, 'id_taken', 'A world with this id is already public under another author.');
}

/**
 * Publish a tenant draft: a clean copy (play reset) goes to the public area,
 * then the draft leaves the tenant. Copy-then-trash, never rename: the tenant
 * and the public area are separate volumes on the hosted deploy.
 *
 * Under the identity service all of it runs inside the world's lease, and
 * `lease.publish()` flips the record once the files are in place.
 */
export async function publishFromTenant(repoRoot: string, uid: string, id: unknown): Promise<{ ok: true; id: string; publishedAt: string; revision: number }> {
  const client = resourcesFor(uid);
  if (client) {
    const draft = await tenantOriginal(repoRoot, uid, id);
    const worldId = String(draft.manifest.id);
    await refuseForeignPublic(repoRoot, uid, worldId);
    const record = await ownRecord(client, worldId, draft.manifest);
    const root = publishedRoot(repoRoot);
    return tenancy(() => client.withLease(KIND, worldId, async (lease) => {
      const publishedAt = new Date().toISOString();
      await copyToPublic(repoRoot, uid, draft, worldId, publishedAt);
      try {
        await lease.publish();
      } catch (error) {
        // The record did not flip: a first publish takes its copy back out.
        if (record.status !== 'published') await trashDir(root, worldId);
        throw error;
      }
      // The tenant keeps only what is not published.
      await trashDir(tenantWorldsRoot(repoRoot, uid), worldId);
      return { ok: true as const, id: worldId, publishedAt, revision: syncMetaOf(draft.manifest).revision };
    }, { ttlSeconds: LEASE_TTL }), noDraft());
  }
  return holdingWorld(id, () => withUserLock(uid, async () => {
    const draft = await tenantOriginal(repoRoot, uid, id);
    const worldId = String(draft.manifest.id);
    await refuseForeignPublic(repoRoot, uid, worldId);
    const publishedAt = new Date().toISOString();
    await copyToPublic(repoRoot, uid, draft, worldId, publishedAt);
    // The tenant keeps only what is not published.
    await trashDir(tenantWorldsRoot(repoRoot, uid), worldId);
    return { ok: true, id: worldId, publishedAt, revision: syncMetaOf(draft.manifest).revision };
  }));
}

const notAuthor = () => new BundleError(403, 'not_owner', 'Only the author can unpublish this world.');

/**
 * Put a public world back into its owner's tenant as a draft. Normally a copy
 * (staging → rename). When the owner still holds an ORIGINAL with this id —
 * published from a hosted seat before its publish went through sync, which
 * left the original in place — that original is kept and marked draft instead:
 * it is the author's own, at least as new as the public snapshot.
 */
async function returnToTenant(repoRoot: string, owner: string, world: { dir: string; manifest: Record<string, unknown>; meta: WorkshopMeta }, worldId: string, takenDown?: TakenDown): Promise<'copied' | 'kept'> {
  const note = takenDown ? { takenDown } : {};
  const tenant = tenantWorldsRoot(repoRoot, owner);
  await fs.mkdir(tenant, { recursive: true });
  const now = new Date().toISOString();
  const existing = await readManifestFile(path.join(tenant, worldId));
  if (existing) {
    const meta = workshopOf(existing);
    if (existing.id !== worldId || !meta || meta.owner !== owner) throw new BundleError(409, 'draft_exists', 'You already have a draft with this id in your remote space.');
    const { publishedAt: _dropped, ...rest } = meta;
    await writeManifestFile(path.join(tenant, worldId), { ...existing, workshop: { ...rest, ...note, status: 'draft', owner }, updatedAt: now });
    return 'kept';
  }
  const staging = path.join(tenant, `.staging-${worldId}-${randomUUID()}`);
  try {
    await copyTree(world.dir, staging);
    const { publishedAt: _dropped, ...meta } = world.meta;
    await writeManifestFile(staging, { ...world.manifest, workshop: { ...meta, ...note, status: 'draft', owner }, updatedAt: now });
    await fs.rename(staging, path.join(tenant, worldId));
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
  return 'copied';
}

/** Unpublish: the public world goes back into its owner's tenant as a draft. */
export async function unpublishToTenant(repoRoot: string, uid: string, id: unknown): Promise<{ ok: true; id: string }> {
  const client = resourcesFor(uid);
  if (client) {
    const world = await publicWorld(repoRoot, id);
    const worldId = String(world.manifest.id);
    const record = await tenancy(async () => publicRecord(client, await getOrNull(client, worldId), worldId, world.manifest, world.meta));
    if (!record) throw noPublic();
    if (!record.mine) throw notAuthor();
    return tenancy(() => client.withLease(KIND, worldId, async (lease) => {
      const placed = await returnToTenant(repoRoot, uid, world, worldId);
      try {
        await lease.unpublish();
      } catch (error) {
        if (placed === 'copied') await trashDir(tenantWorldsRoot(repoRoot, uid), worldId);
        throw error;
      }
      await trashDir(publishedRoot(repoRoot), worldId);
      return { ok: true as const, id: worldId };
    }, { ttlSeconds: LEASE_TTL }), notAuthor());
  }
  return holdingWorld(id, () => withUserLock(uid, async () => {
    const world = await publicWorld(repoRoot, id);
    if (world.meta.owner !== uid) throw notAuthor();
    const worldId = String(world.manifest.id);
    await returnToTenant(repoRoot, uid, world, worldId);
    await trashDir(publishedRoot(repoRoot), worldId);
    return { ok: true, id: worldId };
  }));
}

/**
 * 强制撤回: an admin takes ANY public world
 * out of the public area. It goes back to its ORIGINAL author's tenant as a
 * draft — never the admin's (one world, one tenant) — carrying a `takenDown`
 * note so the author sees who took it down, when, and why. Who is an admin is
 * decided by the route (`AIRP_SYNC_ADMINS`), never here.
 *
 * Under the identity service the move runs in the world's lease acting AS THE
 * AUTHOR (the record is theirs; the service key may act for any account), so
 * it cannot race the author's own submission. Every takedown is appended to
 * `<published>/.audit/takedowns.jsonl`.
 */
export async function forceUnpublishToOwner(repoRoot: string, adminUid: string, id: unknown, reason?: unknown): Promise<{ ok: true; id: string; owner: string }> {
  const world = await publicWorld(repoRoot, id);
  const worldId = String(world.manifest.id);
  const owner = world.meta.owner;
  if (!accountUid(owner)) throw new BundleError(409, 'no_owner', 'This public world has no account to return it to.');
  const why = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
  const takenDown: TakenDown = { by: adminUid, at: new Date().toISOString(), ...(why ? { reason: why } : {}) };
  const move = async () => {
    const current = await publicWorld(repoRoot, worldId);
    if (current.meta.owner !== owner) throw noPublic();
    const placed = await returnToTenant(repoRoot, owner, current, worldId, takenDown);
    return placed;
  };
  const client = resourcesFor(owner);
  if (client) {
    // Acting as the author: their record, registered on first sight like their own 撤回发布.
    const record = await tenancy(async () => publicRecord(client, await getOrNull(client, worldId), worldId, world.manifest, world.meta));
    if (!record?.mine) throw noPublic();
    await tenancy(() => client.withLease(KIND, worldId, async (lease) => {
      const placed = await move();
      try {
        await lease.unpublish();
      } catch (error) {
        if (placed === 'copied') await trashDir(tenantWorldsRoot(repoRoot, owner), worldId);
        throw error;
      }
      await trashDir(publishedRoot(repoRoot), worldId);
    }, { ttlSeconds: LEASE_TTL }), noPublic());
  } else {
    await holdingWorld(worldId, () => withUserLock(owner, async () => {
      await move();
      await trashDir(publishedRoot(repoRoot), worldId);
    }));
  }
  await appendTakedownAudit(repoRoot, { ...takenDown, id: worldId, owner });
  return { ok: true, id: worldId, owner };
}

async function appendTakedownAudit(repoRoot: string, entry: TakenDown & { id: string; owner: string }): Promise<void> {
  const dir = path.join(publishedRoot(repoRoot), '.audit');
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.appendFile(path.join(dir, 'takedowns.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 });
  } catch (error) {
    // The takedown itself is done; a lost audit line is logged, not a failed request.
    console.warn('[Sync] takedown audit not written:', error instanceof Error ? error.message : String(error));
  }
  console.log(`[Sync] takedown ${entry.id} (owner ${entry.owner.slice(0, 8)}…) by ${entry.by.slice(0, 8)}…`);
}
