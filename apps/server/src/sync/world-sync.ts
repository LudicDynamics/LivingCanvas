import fs from 'node:fs/promises';
import path from 'node:path';
import { userId, worldsRoot } from '../engine/user-root.js';
import { MADE_ID, isOfficialId, workshopOf } from '../world-workshop.js';
import { readManifestFile, writeManifestFile } from './bundle.js';
import { contentStamp, manifestDigest, markSynced } from './stamp.js';
import { RemoteError, pairOf, pullFromRemote, pushToRemote, readRemoteConfig, remoteWorlds, type RemoteDeps } from './remote-client.js';

/**
 * 本机 / 云端: where a world made in
 * the workshop is KEPT. Play and creation always happen on the local copy — the
 * disk (`pnpm dev`) or this browser's storage (the browser version); a 云端 world
 * also has a copy in the account (identity resource + storage revision, the same
 * upload the 「发布」 button already uses), brought up to date by `syncWorlds`:
 * on leaving a world, every few minutes, and on 「立即同步」.
 *
 *   world.json `location`  'cloud' | 'local' — this device's choice (stripped from bundles).
 *                          Absent: 'cloud' when the world is paired with a draft in the account
 *                          (uploaded before this existed), else 'local'.
 *   world.json `remote`    the existing pair, plus `stamp` (newest content mtime when it was
 *                          uploaded or downloaded), `manifestDigest` (world.json without the
 *                          device fields) and `conflictRevision` (a newer cloud revision met
 *                          while this copy had changes of its own).
 *
 * Never merged: a cloud copy that moved on while this
 * device also changed is a CONFLICT, and the only resolution is 「两份都保留」 —
 * the cloud version comes down as a second world, nothing is overwritten.
 */

export type WorldLocation = 'cloud' | 'local';
/** Per world: what the last look found / did. */
export type WorldSyncState = 'synced' | 'pending' | 'pushed' | 'pulled' | 'behind' | 'conflict' | 'error';

export interface WorldSyncEntry { path: string; id: string; name: string; state: WorldSyncState; error?: string }
export interface WorldSyncStatus {
  ok: true;
  signedIn: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  worlds: WorldSyncEntry[];
}

/** mtime slack: a pair written right after an upload must not make the world look changed. */
const SLACK_MS = 2_000;

export function locationOf(manifest: Record<string, unknown> | null | undefined): WorldLocation {
  if (manifest?.location === 'cloud') return 'cloud';
  if (manifest?.location === 'local') return 'local';
  return pairOf(manifest)?.from === 'tenant' ? 'cloud' : 'local';
}

interface DevicePair { stamp?: unknown; manifestDigest?: unknown; conflictRevision?: unknown; revision?: unknown }
const devicePair = (manifest: Record<string, unknown>): DevicePair => (typeof manifest.remote === 'object' && manifest.remote !== null ? manifest.remote as DevicePair : {});

/** Has this copy changed since it last matched the cloud? (A cloud world never uploaded: yes.) */
export async function localPending(dir: string, manifest: Record<string, unknown>): Promise<boolean> {
  const pair = pairOf(manifest);
  const device = devicePair(manifest);
  if (!pair || pair.from !== 'tenant' || typeof device.stamp !== 'number' || typeof device.manifestDigest !== 'string') return true;
  if (device.manifestDigest !== manifestDigest(manifest)) return true;
  return (await contentStamp(dir)) > device.stamp + SLACK_MS;
}

/**
 * The shelf's word for a save. `official`: an official edition its owner
 * downloaded to edit (feat/world-owner, `workshop.official`) — still 官方, and never auto-synced: it goes
 * back only through the owner's 「重新发布」.
 */
export interface SavePlace { location: WorldLocation | 'official'; pending: boolean; conflict: boolean }

/** An official edition's owner copy (`worlds/<edition id>`, `workshop.official`). */
export const isOfficialCopy = (manifest: Record<string, unknown> | null | undefined) => workshopOf(manifest)?.official === true;

/** Where an author's original lives and whether it is ahead of / at odds with its cloud copy. */
export async function placeOf(dir: string, manifest: Record<string, unknown>): Promise<SavePlace> {
  if (isOfficialCopy(manifest)) return { location: 'official', pending: false, conflict: false };
  const location = locationOf(manifest);
  if (location === 'local') return { location, pending: false, conflict: false };
  const conflict = typeof devicePair(manifest).conflictRevision === 'number';
  return { location, pending: conflict || await localPending(dir, manifest), conflict };
}

// ── the pass ────────────────────────────────────────────────────────────────

let running: Promise<WorldSyncStatus> | null = null;
let last: { at: string | null; error: string | null; worlds: WorldSyncEntry[] } = { at: null, error: null, worlds: [] };

const nameOf = (m: Record<string, unknown>, id: string) => (typeof m.name === 'string' && m.name ? m.name : id);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Original { id: string; dir: string; manifest: Record<string, unknown> }

/** This user's workshop originals (id = directory name, owner = this user). */
async function originals(root: string): Promise<Original[]> {
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const me = userId();
  const out: Original[] = [];
  for (const d of dirs) {
    if (!d.isDirectory() || !MADE_ID.test(d.name)) continue;
    const dir = path.join(root, d.name);
    const manifest = await readManifestFile(dir);
    const meta = workshopOf(manifest);
    // An official edition's owner copy is not the sync's: it goes back only by 「重新发布」.
    if (!manifest || !meta || manifest.id !== d.name || meta.owner !== me || meta.official === true) continue;
    out.push({ id: d.name, dir, manifest });
  }
  return out;
}

/** Cloud ids whose local copy this device moved to the trash: not brought back by the next pass. */
async function trashedPairs(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  const trash = path.join(root, '.trash');
  const dirs = await fs.readdir(trash, { withFileTypes: true }).catch(() => []);
  await Promise.all(dirs.filter((d) => d.isDirectory() && d.name.startsWith('made-')).map(async (d) => {
    const pair = pairOf(await readManifestFile(path.join(trash, d.name)));
    if (pair?.from === 'tenant') out.add(pair.id);
  }));
  return out;
}

export function syncStatusView(signedIn: boolean): WorldSyncStatus {
  return { ok: true, signedIn, running: running !== null, lastRunAt: last.at, lastError: last.error, worlds: last.worlds };
}

export async function worldSyncStatus(): Promise<WorldSyncStatus> {
  const config = await readRemoteConfig().catch(() => null);
  return syncStatusView(Boolean(config?.session));
}

/**
 * One pass over this user's 云端 worlds: upload what changed here, download what
 * changed in the account (only while this copy has no changes of its own and is
 * not the open world), bring down cloud worlds this device does not have, and mark
 * conflicts. One pass at a time; a second caller gets the running one's answer.
 * `only`: just this world (`worlds/made-…`), e.g. right after 「上传到云端」.
 */
export function syncWorlds(repoRoot: string, deps: RemoteDeps = {}, only?: string): Promise<WorldSyncStatus> {
  if (running) return running;
  running = (async () => {
    const config = await readRemoteConfig().catch(() => null);
    if (!config?.session) return syncStatusView(false);
    const root = worldsRoot(repoRoot);
    const active = deps.activeStore?.() ?? null;
    const isActive = (dir: string) => Boolean(active && path.resolve(active.worldRoot) === path.resolve(dir));
    const results: WorldSyncEntry[] = [];
    try {
      const list = await remoteWorlds(repoRoot, deps);
      const cloudRevision = new Map(list.drafts.map((d) => [d.id, Number(d.revision) || 0]));
      const known = new Set<string>();
      for (const world of await originals(root)) {
        const pair = pairOf(world.manifest);
        if (pair?.from === 'tenant' && pair.url === config.url) known.add(pair.id);
        const worldPath = `worlds/${world.id}`;
        if (locationOf(world.manifest) !== 'cloud' || (only && only !== worldPath)) continue;
        const entry: WorldSyncEntry = { path: worldPath, id: world.id, name: nameOf(world.manifest, world.id), state: 'synced' };
        results.push(entry);
        try {
          const paired = pair && pair.from === 'tenant' && pair.url === config.url ? pair : null;
          const remoteRev = paired ? cloudRevision.get(paired.id) : undefined;
          const behind = paired !== null && remoteRev !== undefined && remoteRev > paired.revision;
          const pending = await localPending(world.dir, world.manifest);
          if (behind && pending) {
            entry.state = 'conflict';
            const remote = { ...(world.manifest.remote as Record<string, unknown>), conflictRevision: remoteRev };
            await writeManifestFile(world.dir, { ...world.manifest, remote });
          } else if (behind) {
            if (isActive(world.dir)) { entry.state = 'behind'; continue; }
            const pulled = await pullFromRemote(repoRoot, { id: paired!.id, from: 'tenant', replace: true }, deps);
            const dir = path.join(root, pulled.id);
            const fresh = await readManifestFile(dir);
            if (fresh) await markSynced(dir, await contentStamp(dir), manifestDigest(fresh), 'cloud');
            entry.state = 'pulled';
          } else if (pending) {
            await pushToRemote(repoRoot, worldPath, deps); // stamps the pair itself (stamp.ts)
            entry.state = 'pushed';
          }
        } catch (e) {
          entry.state = 'error';
          entry.error = message(e);
          if (e instanceof RemoteError && (e.code === 'not_connected' || e.code === 'signed_out')) throw e;
        }
      }
      // Cloud worlds this device has not got yet (made or kept on another device).
      if (!only) {
        const trashed = await trashedPairs(root);
        for (const draft of list.drafts) {
          // Official editions in "my drafts" (their owner's) come down only when the owner asks (下载下来编辑).
          if (known.has(draft.id) || trashed.has(draft.id) || draft.local || isOfficialId(draft.id) || (draft as { official?: unknown }).official === true) continue;
          const entry: WorldSyncEntry = { path: '', id: draft.id, name: typeof (draft as { name?: unknown }).name === 'string' ? String((draft as { name?: unknown }).name) : draft.id, state: 'pulled' };
          results.push(entry);
          try {
            const pulled = await pullFromRemote(repoRoot, { id: draft.id, from: 'tenant' }, deps);
            const dir = path.join(root, pulled.id);
            const fresh = await readManifestFile(dir);
            if (fresh) await markSynced(dir, await contentStamp(dir), manifestDigest(fresh), 'cloud');
            entry.path = pulled.worldPath;
            entry.id = pulled.id;
          } catch (e) {
            entry.state = 'error';
            entry.error = message(e);
          }
        }
      }
      const failed = results.find((r) => r.state === 'error');
      last = { at: new Date().toISOString(), error: failed?.error ?? null, worlds: only ? mergeOne(last.worlds, results) : results };
    } catch (e) {
      last = { at: new Date().toISOString(), error: message(e), worlds: results.length ? results : last.worlds };
    }
    return syncStatusView(true);
  })().finally(() => { running = null; });
  return running;
}

const mergeOne = (previous: WorldSyncEntry[], next: WorldSyncEntry[]) => [...previous.filter((p) => !next.some((n) => n.path === p.path)), ...next];

/** Original at `worlds/made-…` of this user, or a 4xx. */
async function ownOriginal(repoRoot: string, worldPath: unknown): Promise<Original> {
  if (typeof worldPath !== 'string' || !/^worlds\/made-[a-f0-9]{8}$/.test(worldPath)) throw new RemoteError(400, 'invalid_argument', 'Expected the save path of a world made in the workshop.');
  const id = worldPath.slice('worlds/'.length);
  const world = (await originals(worldsRoot(repoRoot))).find((w) => w.id === id);
  if (!world) throw new RemoteError(404, 'not_found', 'Only a world you made here can be kept in the cloud.');
  return world;
}

/** 「上传到云端」: a 本机 world becomes a 云端 one and is uploaded now. */
export async function keepInCloud(repoRoot: string, worldPath: unknown, deps: RemoteDeps = {}): Promise<WorldSyncStatus> {
  const config = await readRemoteConfig().catch(() => null);
  if (!config?.session) throw new RemoteError(409, 'not_connected', 'Sign in to keep worlds in the cloud.');
  const world = await ownOriginal(repoRoot, worldPath);
  if (world.manifest.location !== 'cloud') await writeManifestFile(world.dir, { ...world.manifest, location: 'cloud' });
  if (running) await running.catch(() => null);
  return syncWorlds(repoRoot, deps, `worlds/${world.id}`);
}

const COPY_SUFFIX: Record<string, string> = { 'zh-CN': '（云端版本）', zh: '（云端版本）', ja: '（クラウド版）', ko: ' (클라우드 버전)', en: ' (cloud version)' };

/**
 * 「两份都保留」 for a conflict: the cloud's newer version comes down as a SECOND
 * 云端 world (new id, name marked as the cloud version, uploaded as its own world
 * by the next pass); this copy keeps its pairing, acknowledges the cloud revision
 * it saw, and its own changes go up as the next revision. Nothing is overwritten:
 * the other device's work survives as that second world.
 */
export async function keepBoth(repoRoot: string, worldPath: unknown, deps: RemoteDeps = {}) {
  const world = await ownOriginal(repoRoot, worldPath);
  const remote = (typeof world.manifest.remote === 'object' && world.manifest.remote ? world.manifest.remote : {}) as Record<string, unknown>;
  const pair = pairOf(world.manifest);
  if (typeof remote.conflictRevision !== 'number' || !pair) throw new RemoteError(409, 'no_conflict', 'This world has no conflict to resolve.');
  const copy = await pullFromRemote(repoRoot, { id: pair.id, from: 'tenant', asCopy: true }, deps);
  const copyDir = path.join(worldsRoot(repoRoot), copy.id);
  const copied = await readManifestFile(copyDir);
  if (copied) {
    const locale = typeof copied.locale === 'string' ? copied.locale : 'en';
    const suffix = COPY_SUFFIX[locale] ?? COPY_SUFFIX[locale.split('-')[0]] ?? COPY_SUFFIX.en;
    const meta = workshopOf(copied);
    await writeManifestFile(copyDir, { ...copied, name: `${nameOf(copied, copy.id)}${suffix}`, location: 'cloud', ...(meta ? { workshop: { ...meta, status: 'draft' } } : {}) });
  }
  const { conflictRevision, ...rest } = remote;
  await writeManifestFile(world.dir, { ...world.manifest, remote: { ...rest, revision: conflictRevision } });
  const status = await syncWorlds(repoRoot, deps);
  return { ...status, copyPath: copy.worldPath };
}

export { contentStamp, manifestDigest } from './stamp.js';
