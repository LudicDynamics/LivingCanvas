import express from 'express';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { publishedRoot } from '../engine/user-root.js';
import { worldCover } from '../world-shelf.js';

/**
 * Browser mode's world catalog, dev host side. The in-tab runtime lists worlds,
 * fetches covers and downloads a world's files through ONE client interface
 * (apps/browser-runtime/src/catalog.ts). In production that client talks to the
 * identity service (resources) and storage.worldlines.gg (bytes by revision);
 * here the host answers the same shapes from the repo's `templates/` (every
 * edition) and the host's published root, so the runtime does not care which:
 *
 *   GET /v1/resources?scope=public&product=livingcanvas&kind=world
 *       identity `GET /v1/resources` shape → {resources: [view], next_cursor}.
 *       `meta.world` carries the world's `world.json` and `meta.cover` /
 *       `meta.coverVideo` the cover files ({path, size, sha256}) — the
 *       "enriched with the manifest" listing the launcher needs.
 *   GET /v1/objects/livingcanvas/world/:id/download-url?revision=
 *       storage §4.3 shape → {…, revision, hash, size, files: [{path, size, sha256, url}]}
 *   GET /blob/:sha256
 *       the bytes, content-addressed and immutable (the "presigned URL" here).
 *
 * `hash` follows storage §2: `sha256:` + SHA-256 over `<sha256> <size> <path>`
 * lines sorted by path. Templates have no revisions on the host: revision 1.
 */
const SKIP_DIRS = new Set(['.airpworld', '.pi', '.git', 'node_modules']);
const SKIP_FILES = /^(\.DS_Store|\.gitignore|Thumbs\.db)$/;

type FileEntry = { path: string; size: number; sha256: string };
type CatalogWorld = {
  id: string; source: 'template' | 'published'; dir: string; manifest: Record<string, unknown>;
  files: FileEntry[]; hash: string; size: number; updatedAt: string;
  cover: FileEntry | null; coverVideo: FileEntry | null;
};

export function createBrowserCatalog(repoRoot: string): express.Router {
  const fileHashes = new Map<string, { key: string; sha256: string }>(); // abs → (size:mtime) → sha
  const blobs = new Map<string, string>(); // sha256 → abs path

  function listFiles(dir: string, rel = '', out: { abs: string; path: string; size: number; mtimeMs: number }[] = []) {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) listFiles(dir, r, out); }
      else if (e.isFile() && !SKIP_FILES.test(e.name)) {
        const abs = path.join(dir, r);
        const st = fs.statSync(abs);
        out.push({ abs, path: r, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
    return out;
  }

  async function sha(abs: string, size: number, mtimeMs: number) {
    const key = `${size}:${mtimeMs}`;
    const hit = fileHashes.get(abs);
    if (hit?.key === key) return hit.sha256;
    const sha256 = createHash('sha256').update(await fs.promises.readFile(abs)).digest('hex');
    fileHashes.set(abs, { key, sha256 });
    return sha256;
  }

  async function readWorld(dir: string, id: string, source: CatalogWorld['source']): Promise<CatalogWorld | null> {
    let manifest: Record<string, unknown>;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8')); } catch { return null; }
    if (typeof manifest.id !== 'string') return null;
    const listed = listFiles(dir).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const files: FileEntry[] = [];
    let size = 0, newest = 0;
    for (const f of listed) {
      const sha256 = await sha(f.abs, f.size, f.mtimeMs);
      blobs.set(sha256, f.abs);
      files.push({ path: f.path, size: f.size, sha256 });
      size += f.size;
      newest = Math.max(newest, f.mtimeMs);
    }
    const hash = `sha256:${createHash('sha256').update(files.map((f) => `${f.sha256} ${f.size} ${f.path}\n`).join('')).digest('hex')}`;
    const scope = source === 'template' ? 'template' : 'published';
    const pick = async (kind: 'image' | 'video') => {
      const abs = await worldCover(repoRoot, id, kind, scope).catch(() => null);
      const rel = abs ? path.relative(await fs.promises.realpath(dir), abs).split(path.sep).join('/') : null;
      return rel ? files.find((f) => f.path === rel) ?? null : null;
    };
    return { id, source, dir, manifest, files, hash, size, updatedAt: new Date(newest).toISOString(), cover: await pick('image'), coverVideo: await pick('video') };
  }

  let cache: { at: number; worlds: CatalogWorld[] } | null = null;
  async function worlds(): Promise<CatalogWorld[]> {
    if (cache && Date.now() - cache.at < 5000) return cache.worlds;
    const out: CatalogWorld[] = [];
    const roots: [string, CatalogWorld['source']][] = [[path.join(repoRoot, 'templates'), 'template'], [publishedRoot(repoRoot), 'published']];
    for (const [root, source] of roots) {
      const dirs = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^[a-zA-Z0-9][\w-]*$/.test(d.name)) : [];
      for (const d of dirs) {
        const w = await readWorld(path.join(root, d.name), d.name, source);
        // A published directory counts only when it is a made world under its own id (as readWorldShelf).
        if (w && (source === 'template' || (w.manifest.id === d.name && typeof w.manifest.workshop === 'object'))) out.push(w);
      }
    }
    cache = { at: Date.now(), worlds: out };
    return out;
  }

  const view = (w: CatalogWorld) => ({
    product: 'livingcanvas', kind: 'world', id: w.id,
    owner_id: w.source === 'template' ? 'worldlines' : String((w.manifest.workshop as any)?.owner ?? 'unknown'),
    mine: false, status: 'published', title: String(w.manifest.name ?? w.id),
    meta: {
      source: w.source,
      locale: typeof w.manifest.locale === 'string' ? w.manifest.locale : null,
      edition: w.id.replace(/-(zh|jp|ko|en)$/, ''),
      description: typeof w.manifest.description === 'string' ? w.manifest.description : '',
      exp: w.manifest.exp === true,
      world: w.manifest, cover: w.cover, coverVideo: w.coverVideo,
    },
    revision: 1, hash: w.hash, size: w.size,
    created_at: w.updatedAt, updated_at: w.updatedAt, committed_at: w.updatedAt, published_at: w.updatedAt,
  });

  // Hash every world once in the background at startup, so the first tab does not wait for it.
  setTimeout(() => { void worlds().catch(() => {}); }, 0).unref?.();

  const router = express.Router();
  router.get('/v1/resources', async (req, res) => {
    if (req.query.scope === 'mine') return res.json({ resources: [], next_cursor: null }); // no accounts on the dev host
    if ((req.query.product && req.query.product !== 'livingcanvas') || (req.query.kind && req.query.kind !== 'world')) return res.json({ resources: [], next_cursor: null });
    try {
      res.json({ resources: (await worlds()).map(view), next_cursor: null });
    } catch (e) {
      res.status(500).json({ error: 'internal', message: (e as Error).message });
    }
  });
  router.get('/v1/objects/livingcanvas/world/:id/download-url', async (req, res) => {
    const w = (await worlds()).find((x) => x.id === req.params.id);
    if (!w) return res.status(404).json({ error: 'not_found' });
    if (req.query.revision && String(req.query.revision) !== '1') return res.status(404).json({ error: 'not_found' });
    const base = `${req.baseUrl}/blob`;
    res.set('Cache-Control', 'no-cache');
    res.json({
      product: 'livingcanvas', kind: 'world', id: w.id, status: 'published', revision: 1, hash: w.hash, size: w.size,
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      files: w.files.map((f) => ({ ...f, url: `${base}/${f.sha256}` })),
    });
  });
  router.get('/blob/:sha256', async (req, res) => {
    const sha256 = req.params.sha256;
    if (!/^[0-9a-f]{64}$/.test(sha256)) return res.status(400).end();
    if (!blobs.has(sha256)) await worlds();
    const abs = blobs.get(sha256);
    if (!abs || !fs.existsSync(abs)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('application/octet-stream');
    res.sendFile(abs);
  });
  return router;
}
