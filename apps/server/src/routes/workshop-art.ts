/**
 * Creation-mode art: the 素材 panel's four routes.
 *
 *   GET  /api/workshop/art           every picture the world needs, with its prompt and whether it exists
 *   POST /api/workshop/art/prompt    { slot, prompt }                 write a slot's prompt into its owner's frontmatter
 *   POST /api/workshop/art/generate  { slot, prompt?, cutout? }       paint it from its prompt (the cover painter)
 *   POST /api/workshop/art/upload    { slot, mimeType, dataB64, cutout? }  bring a picture instead
 *
 * Only for the author's own DRAFT workshop world (`isAuthoringWorld` +
 * `workshop.status: draft`): a published world is frozen until it is
 * unpublished, and a play copy or a curated world is not the author's to paint.
 *
 * After a picture lands the page is wired to it, and only then (the file now
 * exists): a layer scene → that README's `bg`, a map → `map.plan.picture`, a
 * portrait → the character's / NPC card's `avatar` (and the world.json
 * character entry). No cutout runs here — `cutout: true` only records the
 * request on `art.portrait.cutout`; tools/art/cutout-portrait.py does the cut
 * offline (assets/skills/world-art/SKILL.md §4).
 */
import { Router, type Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ART_PROMPT_MAX,
  parseFrontmatter,
  stringifyFrontmatter,
  withArtField,
  withArtPrompt,
  withLandedArt,
  worldArtManifest,
  type ArtDoc,
  type ArtSlot,
  type LocalWorldStore,
} from '@airp/shared';
import { compressImage, type ImageRole } from '@airp/shared/images';
import { COVER_MIME, MAX_UPLOAD_BYTES, WorkshopError, createCoverPainter, isAuthoringWorld, workshopOf, type CoverPainter } from '../world-workshop.js';
import { readAiGateway } from '../ai-gateway.js';

export interface ArtSlotView extends ArtSlot {
  /** `/api/asset` URL of `path` when it exists (cache-busted by mtime). */
  url?: string;
  /** `/api/asset` URL of `inUse` when it exists. */
  inUseUrl?: string;
}

export interface WorkshopArtOptions {
  getStore: () => LocalWorldStore | null;
  /** Injected for tests; defaults to the env-configured cover painter. */
  painter?: () => CoverPainter | null;
}

const EXT_OF_MIME: Record<string, string> = COVER_MIME;
const SAME_EXT: Record<string, string> = { jpeg: 'jpg' };
const normExt = (ext: string) => SAME_EXT[ext] ?? ext;

export async function readJson(store: LocalWorldStore): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await store.readFile('world.json'));
  if (typeof parsed !== 'object' || parsed === null) throw new WorkshopError(500, 'internal', 'world.json is not an object.');
  return parsed as Record<string, unknown>;
}

/** The active world, when it is the author's draft; otherwise the matching 4xx. */
export async function draftWorld(getStore: () => LocalWorldStore | null): Promise<{ store: LocalWorldStore; manifest: Record<string, unknown> }> {
  const store = getStore();
  if (!store) throw new WorkshopError(409, 'no_world', 'Load a world first.');
  const manifest = await readJson(store);
  if (!isAuthoringWorld(store.worldRoot, manifest)) throw new WorkshopError(403, 'not_authoring', 'Only the author of a workshop world can edit its art.');
  if (workshopOf(manifest)?.status !== 'draft') throw new WorkshopError(409, 'not_draft', 'This world is published; unpublish it to edit its art.');
  return { store, manifest };
}

async function readDocs(store: LocalWorldStore): Promise<ArtDoc[]> {
  const files = [
    ...(await store.listFiles('world')).filter((f) => f.endsWith('.md')),
    ...(await store.listFiles('characters')).filter((f) => /^characters\/[^/]+\/README\.md$/.test(f)),
    ...(await store.listFiles('endings')).filter((f) => /^endings\/[^/]+\/README\.md$/.test(f)),
  ];
  const docs: ArtDoc[] = [];
  for (const file of files) {
    try {
      docs.push({ path: file, frontmatter: parseFrontmatter(await store.readFile(file)).frontmatter });
    } catch {
      // An unreadable card has no art to show; it never hides the others.
    }
  }
  return docs;
}

async function mtimes(store: LocalWorldStore, paths: Iterable<string>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const rel of new Set(paths)) {
    const stat = await fs.stat(path.join(store.worldRoot, rel)).catch(() => null);
    if (stat?.isFile()) out.set(rel, Math.floor(stat.mtimeMs));
  }
  return out;
}

const assetUrl = (rel: string, mtime: number) => `/api/asset?path=${encodeURIComponent(rel)}&kind=image&v=${mtime}`;

/** The slot list with existence and URLs. Exported for tests. */
export async function readArtSlots(store: LocalWorldStore, manifest: Record<string, unknown>): Promise<ArtSlotView[]> {
  const docs = await readDocs(store);
  const probe: string[] = [];
  // First pass only learns which paths to stat; the second answers from the disk.
  worldArtManifest({ manifest, docs, exists: (p) => { probe.push(p); return false; } });
  const found = await mtimes(store, probe);
  const slots = worldArtManifest({ manifest, docs, exists: (p) => found.has(p) });
  return slots.map((slot) => ({
    ...slot,
    ...(slot.exists ? { url: assetUrl(slot.path, found.get(slot.path)!) } : {}),
    ...(slot.inUse && slot.inUseExists ? { inUseUrl: assetUrl(slot.inUse, found.get(slot.inUse)!) } : {}),
  }));
}

function slotId(body: unknown): string {
  const id = (body as { slot?: unknown } | null)?.slot;
  if (typeof id !== 'string' || !id || id.length > 300) throw new WorkshopError(400, 'invalid_argument', 'slot is required.');
  return id;
}

function promptOf(body: unknown, required: boolean): string | undefined {
  const raw = (body as { prompt?: unknown } | null)?.prompt;
  if (raw === undefined || raw === null) {
    if (required) throw new WorkshopError(400, 'invalid_argument', 'prompt is required.');
    return undefined;
  }
  if (typeof raw !== 'string') throw new WorkshopError(400, 'invalid_argument', 'prompt must be a string.');
  const prompt = raw.trim();
  if (prompt.length > ART_PROMPT_MAX) throw new WorkshopError(400, 'invalid_argument', `prompt must be at most ${ART_PROMPT_MAX} characters.`);
  return prompt;
}

async function findSlot(store: LocalWorldStore, manifest: Record<string, unknown>, id: string): Promise<ArtSlot> {
  const slot = (await readArtSlots(store, manifest)).find((s) => s.id === id);
  if (!slot) throw new WorkshopError(404, 'not_found', `No art slot ${id}.`);
  return slot;
}

/** Rewrite one README / card's frontmatter; the body is kept byte for byte. */
async function editFrontmatter(store: LocalWorldStore, file: string, edit: (fm: Record<string, unknown>) => Record<string, unknown> | null): Promise<void> {
  const parsed = parseFrontmatter(await store.readFile(file));
  const next = edit({ ...(parsed.frontmatter ?? {}) });
  if (!next) throw new WorkshopError(404, 'not_found', `No art entry to edit in ${file}.`);
  await store.writeFileAtomic(file, stringifyFrontmatter(next, parsed.body));
}

/** A trigger asset's prompt / path lives in world.json `triggers[].assets[]`. */
async function editTriggerAsset(store: LocalWorldStore, slot: ArtSlot, patch: Record<string, unknown>): Promise<void> {
  const [, tid, index] = /^trigger:([^:]+):(\d+)$/.exec(slot.id) ?? [];
  const manifest = await readJson(store);
  const trigger = (Array.isArray(manifest.triggers) ? manifest.triggers : []).find((t) => (t as { id?: unknown })?.id === tid) as { assets?: unknown[] } | undefined;
  const asset = trigger?.assets?.[Number(index)];
  if (!trigger || typeof asset !== 'object' || asset === null) throw new WorkshopError(404, 'not_found', `No art slot ${slot.id}.`);
  trigger.assets![Number(index)] = { ...(asset as Record<string, unknown>), ...patch };
  await store.writeFileAtomic('world.json', JSON.stringify(manifest, null, 2) + '\n');
}

async function writePrompt(store: LocalWorldStore, slot: ArtSlot, prompt: string): Promise<void> {
  if (slot.owner === 'trigger') return editTriggerAsset(store, slot, { prompt });
  await editFrontmatter(store, slot.ownerPath, (fm) => withArtPrompt(fm, slot, prompt));
}

/**
 * Land a picture on a slot: write the bytes (the extension follows the actual
 * type, and the declared path follows the extension), record the prompt/cutout,
 * then wire the page to it. Returns the path it landed at.
 */
/** The long-edge cap a slot's picture gets. */
const ROLE_OF_KIND: Record<ArtSlot['kind'], ImageRole> = { scene: 'scene', cg: 'scene', map: 'map', portrait: 'portrait', item: 'token' };

async function landArt(store: LocalWorldStore, slot: ArtSlot, mimeType: string, bytes: Buffer, cutout: boolean): Promise<string> {
  // Every picture is compressed on the way in; a cutout portrait keeps its alpha.
  const compressed = await compressImage(bytes, { role: ROLE_OF_KIND[slot.kind] ?? 'scene' });
  if (compressed.changed && EXT_OF_MIME[compressed.mimeType]) {
    bytes = Buffer.from(compressed.bytes.buffer, compressed.bytes.byteOffset, compressed.bytes.byteLength);
    mimeType = compressed.mimeType;
  }
  const ext = EXT_OF_MIME[mimeType] ?? 'png';
  const current = /\.([a-z]+)$/i.exec(slot.path)?.[1]?.toLowerCase() ?? '';
  const landed = normExt(current) === normExt(ext) ? slot.path : slot.path.replace(/\.[a-z]+$/i, `.${ext}`);
  await store.writeFile(landed, bytes);
  if (slot.owner === 'trigger') {
    if (landed !== slot.path) await editTriggerAsset(store, slot, { path: landed });
    return landed;
  }
  await editFrontmatter(store, slot.ownerPath, (fm) => {
    let next = withArtField(fm, slot, 'path', landed);
    if (cutout && slot.kind === 'portrait') next = withArtField(next, { ...slot, path: landed }, 'cutout', true);
    return withLandedArt(next, slot, landed);
  });
  if (slot.owner === 'character') {
    const id = slot.id.split(':')[1];
    const manifest = await readJson(store);
    const characters = Array.isArray(manifest.characters) ? manifest.characters : [];
    const entry = characters.find((c) => (c as { id?: unknown })?.id === id) as Record<string, unknown> | undefined;
    if (entry) {
      entry.avatar = landed;
      await store.writeFileAtomic('world.json', JSON.stringify(manifest, null, 2) + '\n');
      await store.getManifest().catch(() => undefined);
    }
  }
  return landed;
}

const cutoutOf = (body: unknown) => (body as { cutout?: unknown } | null)?.cutout === true;

export function failure(res: Response, err: unknown) {
  if (err instanceof WorkshopError) return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
  res.status(500).json({ ok: false, code: 'internal', error: err instanceof Error ? err.message : String(err) });
}

export function createWorkshopArtRouter(options: WorkshopArtOptions): Router {
  const router = Router();
  const painter = options.painter ?? (() => createCoverPainter());
  const canPaint = () => painter() !== null && (options.painter ? true : Boolean(process.env.OPENAI_API_KEY?.trim() || readAiGateway()));

  router.get('/workshop/art', async (_req, res) => {
    try {
      const { store, manifest } = await draftWorld(options.getStore);
      res.json({ ok: true, world: manifest.id, canPaint: canPaint(), slots: await readArtSlots(store, manifest) });
    } catch (err) {
      failure(res, err);
    }
  });

  router.post('/workshop/art/prompt', async (req, res) => {
    try {
      const { store, manifest } = await draftWorld(options.getStore);
      const slot = await findSlot(store, manifest, slotId(req.body));
      await writePrompt(store, slot, promptOf(req.body, true)!);
      res.json({ ok: true, slot: (await readArtSlots(store, await readJson(store))).find((s) => s.id === slot.id) ?? null });
    } catch (err) {
      failure(res, err);
    }
  });

  router.post('/workshop/art/generate', async (req, res) => {
    try {
      const { store, manifest } = await draftWorld(options.getStore);
      let slot = await findSlot(store, manifest, slotId(req.body));
      const given = promptOf(req.body, false);
      if (given !== undefined && given !== slot.prompt) {
        await writePrompt(store, slot, given);
        slot = await findSlot(store, await readJson(store), slot.id);
      }
      if (!slot.prompt) throw new WorkshopError(400, 'invalid_argument', 'Write a prompt for this picture first.');
      const paint = painter();
      if (!paint) throw new WorkshopError(503, 'no_image_model', 'No image model is configured for painting. Upload a picture instead.');
      const painted = await paint(slot.prompt);
      if (!painted.ok) {
        const status = painted.reason === 'no_credentials' ? 503 : painted.reason === 'timeout' ? 504 : 502;
        throw new WorkshopError(status, 'paint_failed', `The picture could not be painted: ${painted.message}`);
      }
      const mimeType = EXT_OF_MIME[painted.mimeType] ? painted.mimeType : 'image/png';
      await landArt(store, slot, mimeType, Buffer.from(painted.dataB64, 'base64'), cutoutOf(req.body));
      res.json({ ok: true, slot: (await readArtSlots(store, await readJson(store))).find((s) => s.id === slot.id) ?? null });
    } catch (err) {
      failure(res, err);
    }
  });

  router.post('/workshop/art/upload', async (req, res) => {
    try {
      const { store, manifest } = await draftWorld(options.getStore);
      const slot = await findSlot(store, manifest, slotId(req.body));
      const { mimeType, dataB64 } = (req.body ?? {}) as { mimeType?: unknown; dataB64?: unknown };
      if (typeof mimeType !== 'string' || !EXT_OF_MIME[mimeType]) throw new WorkshopError(400, 'invalid_argument', 'The picture must be a PNG, JPEG or WebP.');
      if (typeof dataB64 !== 'string' || !dataB64) throw new WorkshopError(400, 'invalid_argument', 'The uploaded picture is empty.');
      if (dataB64.length > (MAX_UPLOAD_BYTES * 4) / 3 + 4) throw new WorkshopError(413, 'too_large', 'The picture must be 8 MB or smaller.');
      const bytes = Buffer.from(dataB64, 'base64');
      if (bytes.length === 0) throw new WorkshopError(400, 'invalid_argument', 'The uploaded picture is empty.');
      if (bytes.length > MAX_UPLOAD_BYTES) throw new WorkshopError(413, 'too_large', 'The picture must be 8 MB or smaller.');
      await landArt(store, slot, mimeType, bytes, cutoutOf(req.body));
      res.json({ ok: true, slot: (await readArtSlots(store, await readJson(store))).find((s) => s.id === slot.id) ?? null });
    } catch (err) {
      failure(res, err);
    }
  });

  return router;
}
