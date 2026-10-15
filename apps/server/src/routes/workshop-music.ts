/**
 * Creation-mode music: the 设定 tab's music picker.
 *
 *   GET  /api/workshop/music?layer=<id>   the world theme and that place's declared bgm / ambient
 *   POST /api/workshop/music              { layer: "world" | "map" | "world/...", track?, ambient? }
 *
 * Same guard as the other workshop routes (`draftWorld`): only the author's own
 * DRAFT. The write is the writer's own `set_music` action (catalog-checked, one
 * `music_changed` event), so the page crossfades exactly as when the writer
 * changes the music.
 */
import { Router } from 'express';
import { createActionService, layerReadmeOf, parseFrontmatter, worldTypeOf, type LocalWorldStore } from '@airp/shared';
import { WorkshopError } from '../world-workshop.js';
import { draftWorld, failure } from './workshop-art.js';

export interface WorkshopMusicOptions {
  getStore: () => LocalWorldStore | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

async function placeOf(store: LocalWorldStore, layer: string) {
  const where = layerReadmeOf(layer);
  if (!where) throw new WorkshopError(400, 'invalid_argument', 'layer must be map or a world/... layer.');
  if ((await store.statKind(where.readme)) !== 'file') return { layer: where.layer, name: where.layer, bgm: null, ambient: null, exists: false };
  const fm = parseFrontmatter(await store.readFile(where.readme)).frontmatter ?? {};
  const name = str(fm.name)?.trim() || str(fm.title)?.trim() || where.layer.split('/').pop() || where.layer;
  return { layer: where.layer, name, bgm: str(fm.bgm), ambient: str(fm.ambient), exists: true };
}

export function createWorkshopMusicRouter(options: WorkshopMusicOptions): Router {
  const router = Router();

  router.get('/workshop/music', async (req, res) => {
    try {
      const { store, manifest } = await draftWorld(options.getStore);
      const audio = (manifest.audio ?? {}) as { theme?: unknown };
      const typeDefault = worldTypeOf((manifest.theme as { type?: string } | undefined)?.type)?.audioTheme ?? null;
      const layer = typeof req.query.layer === 'string' && req.query.layer.trim() ? req.query.layer.trim() : 'map';
      res.json({ ok: true, world: { theme: str(audio.theme), typeDefault }, place: await placeOf(store, layer) });
    } catch (err) {
      failure(res, err);
    }
  });

  router.post('/workshop/music', async (req, res) => {
    try {
      const { store } = await draftWorld(options.getStore);
      const body = (req.body ?? {}) as { layer?: unknown; track?: unknown; ambient?: unknown };
      const layer = str(body.layer)?.trim();
      if (!layer) throw new WorkshopError(400, 'invalid_argument', 'layer is required.');
      const track = str(body.track) ?? undefined;
      const ambient = str(body.ambient) ?? undefined;
      // The author's hand, like God Hand: the same action the writer's set_music runs.
      const result = await createActionService(store, { type: 'god' }).setMusic({ layer, track, ambient });
      res.json({ ok: true, ...(result.details as Record<string, unknown>), event: undefined });
    } catch (err) {
      const e = err as { code?: unknown; message?: unknown };
      if (e && typeof e.code === 'string' && (e.code === 'invalid_argument' || e.code === 'not_found')) {
        return res.status(e.code === 'not_found' ? 404 : 400).json({ ok: false, code: e.code, error: String(e.message) });
      }
      failure(res, err);
    }
  });

  return router;
}
