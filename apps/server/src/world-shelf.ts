import fs from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { publishedRoot, userId, worldsRoot } from './engine/user-root.js';
import { workshopOf, type WorkshopMeta } from './world-workshop.js';
import { withContentHash } from './asset-hash.js';
import { introAvatarFile, shelfIntroOf, type ShelfIntro } from './lobby-intro.js';
import { worldCategoryIdOf } from '@airp/shared';
import { placeOf, type SavePlace } from './sync/world-sync.js';

export class ShelfError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function entries(root: string) {
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return (await Promise.all(dirs.filter(d => d.isDirectory() && !d.name.startsWith('.')).map(async d => {
    try {
      const dir = path.join(root, d.name);
      const manifest = JSON.parse(await fs.readFile(path.join(dir, 'world.json'), 'utf8'));
      if (typeof manifest.id !== 'string') return null;
      const times = await Promise.all(['world.json', '.airpworld/history.db', '.airpworld/history.db-wal', '.airpworld/canvas.db', '.airpworld/canvas.db-wal'].map(f => fs.stat(path.join(dir, f)).then(s => s.mtimeMs).catch(() => 0)));
      return { id: d.name, manifest, updatedAt: new Date(Math.max(...times)).toISOString() };
    } catch { return null; }
  }))).filter((e): e is NonNullable<typeof e> => e !== null);
}

/**
 * The shelf group a save belongs to — the world key chronicle counts it under
 * (`livingcanvas/world/<id>`, the page's `group.id`). A made world (workshop
 * block) is its own manifest id; otherwise the template whose manifest id it
 * carries, else (older scaffolded copies changed manifest.id) the longest
 * template id its directory name starts with. Never a translated display name.
 */
export function shelfGroupIdOf(saveId: string, manifest: Record<string, unknown>, templates: readonly { id: string; manifest: Record<string, unknown> }[]): string {
  const template = workshopOf(manifest) ? null : templates.find(t => t.manifest.id === manifest.id)
    ?? [...templates].sort((a, b) => b.id.length - a.id.length).find(t => saveId.startsWith(`${t.id}-`));
  return template?.id ?? String(manifest.id);
}

const worldKeys = new Map<string, string | null>();
/**
 * The open world's key for the model gateway's X-Worldlines-World header
 * (ai-gateway.ts): `shelfGroupIdOf` for the save at `worldRoot`, read once per
 * root. null when its world.json cannot be read.
 */
export function worldKeyOfRoot(repoRoot: string, worldRoot: string): string | null {
  const root = path.resolve(worldRoot);
  if (worldKeys.has(root)) return worldKeys.get(root)!;
  let key: string | null = null;
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, 'world.json'), 'utf8'));
    if (typeof manifest?.id === 'string') {
      const dir = path.join(repoRoot, 'templates');
      const templates = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).flatMap(d => {
        try { return [{ id: d.name, manifest: JSON.parse(readFileSync(path.join(dir, d.name, 'world.json'), 'utf8')) }]; } catch { return []; }
      });
      key = shelfGroupIdOf(path.basename(root), manifest, templates);
    }
  } catch { key = null; }
  worldKeys.set(root, key);
  return key;
}

const IMAGE_FILE = /\.(webp|png|jpe?g|avif)$/i;

/** The launcher cover: `world.json` `cover`, else the intro (or first) scene/background image. */
export async function coverOf(dir: string, manifest: Record<string, unknown>): Promise<string | null> {
  const declared = typeof manifest.cover === 'string' ? manifest.cover.replace(/^\/+/, '') : '';
  if (declared && IMAGE_FILE.test(declared) && await fs.access(path.join(dir, declared)).then(() => true, () => false)) return declared;
  for (const folder of ['assets/scenes', 'assets/backgrounds']) {
    const files = (await fs.readdir(path.join(dir, folder)).catch(() => [] as string[])).filter(f => IMAGE_FILE.test(f)).sort();
    const pick = files.find(f => /^intro\./i.test(f)) ?? files[0];
    if (pick) return `${folder}/${pick}`;
  }
  return null;
}

const VIDEO_FILE = /\.(webm|mp4)$/i;

/** The launcher's moving cover: `world.json` `coverVideo`, else the world's intro video. */
async function coverVideoOf(dir: string, manifest: Record<string, unknown>): Promise<string | null> {
  const declared = typeof manifest.coverVideo === 'string' ? manifest.coverVideo.replace(/^\/+/, '') : '';
  if (declared && VIDEO_FILE.test(declared) && await fs.access(path.join(dir, declared)).then(() => true, () => false)) return declared;
  for (const folder of ['assets/motion/seedance/backgrounds', 'assets/scenes']) {
    const files = (await fs.readdir(path.join(dir, folder)).catch(() => [] as string[])).filter(f => VIDEO_FILE.test(f)).sort();
    const pick = files.find(f => /^intro\.webm$/i.test(f)) ?? files.find(f => /^intro[.-]/i.test(f));
    if (pick) return `${folder}/${pick}`;
  }
  return null;
}

/**
 * Absolute path of a cover image or video inside one of the three world roots,
 * or null. Read-only; the resolved file must still be under that root.
 *
 * `scope` picks the root: `template` → `templates/<id>` (shared, curated),
 * `save` → the CURRENT user's save root (a made world's own cover),
 * `published` → the shared published root.
 */
export async function worldCover(repoRoot: string, id: unknown, kind: 'image' | 'video' = 'image', scope: 'template' | 'save' | 'published' = 'template'): Promise<string | null> {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) return null;
  const rootDir = scope === 'template' ? path.join(repoRoot, 'templates') : scope === 'save' ? worldsRoot(repoRoot) : publishedRoot(repoRoot);
  const root = await fs.realpath(rootDir).catch(() => null);
  if (!root) return null;
  const dir = path.join(root, id);
  const manifest = await fs.readFile(path.join(dir, 'world.json'), 'utf8').then(JSON.parse, () => null);
  if (!manifest || typeof manifest !== 'object') return null;
  const rel = kind === 'video' ? await coverVideoOf(dir, manifest) : await coverOf(dir, manifest);
  if (!rel) return null;
  const file = await fs.realpath(path.join(dir, rel)).catch(() => null);
  return file && file.startsWith(root + path.sep) && (kind === 'video' ? VIDEO_FILE : IMAGE_FILE).test(file) ? file : null;
}

/** Absolute path of a lobby card portrait (`/api/worlds/intro-avatar`): a template or a published world's cast member `n`. */
export async function worldIntroAvatar(repoRoot: string, id: unknown, n: unknown, scope: 'template' | 'published'): Promise<string | null> {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) return null;
  const index = Number(n);
  if (!Number.isInteger(index)) return null;
  return introAvatarFile(path.join(scope === 'template' ? path.join(repoRoot, 'templates') : publishedRoot(repoRoot), id), index);
}

/** Absolute path of a template's cover image or video, or null. Read-only; never leaves `templates/<id>/`. */
export function templateCover(repoRoot: string, id: unknown, kind: 'image' | 'video' = 'image'): Promise<string | null> {
  return worldCover(repoRoot, id, kind, 'template');
}

type ShelfGroup = {
  id: string;
  name: string;
  templatePath: string | null;
  /** Launcher cover URL (`/api/worlds/cover`), templates only. */
  cover: string | null;
  /** Launcher video URL (`/api/worlds/cover?kind=video`), templates with an intro video only. */
  coverVideo: string | null;
  locale: string | null;
  description: string;
  /** `world.json` `exp: true` — an experimental sandbox, not a shipped edition. */
  exp: boolean;
  /**
   * Present for a world made in the workshop.
   * `mine` — the current seat is its author; `editPath` — the author's
   * original save (`worlds/<id>`), the one that opens for editing.
   */
  workshop?: WorkshopMeta & { mine: boolean; editPath: string | null };
  /** The lobby's "what is this world" card (lobby-intro.ts); templates and published worlds only. */
  intro?: ShelfIntro;
  /**
   * 跑团世界 / 剧情世界 / 自由世界 (`WORLD_CATEGORIES`): the lobby's filter and
   * badge. `intro.category`, else the category its
   * `theme.type` folds into; null — shown only under 「全部」.
   */
  category: string | null;
  saves: { id: string; path: string; updatedAt: string; active: boolean; place: SavePlace }[];
  /**
   * 官方 / 云端 / 本机: `official` a curated template; `cloud` a world kept in
   * the account (the author's 云端 original, or someone's published world); `local` only on this device.
   * `pending` — a 云端 original with changes not uploaded yet (「本机 · 未同步」); `conflict` — the cloud copy
   * moved on while this one changed too.
   */
  place: { kind: 'official' | 'cloud' | 'local'; pending: boolean; conflict: boolean };
};
const LOCAL_PLACE: SavePlace = { location: 'local', pending: false, conflict: false };

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * A world's lobby card with its portraits as `/api/worlds/intro-avatar` URLs
 * (content-hashed like covers). A portrait whose file is not there gets no
 * URL, and the card shows the name's initial instead.
 */
async function introOf(dir: string, manifest: Record<string, unknown>, query: string): Promise<ShelfIntro> {
  return shelfIntroOf(manifest, async (index) => {
    const file = await introAvatarFile(dir, index);
    // A 0-byte file is the browser runtime's placeholder: the URL is still right
    // (the runtime answers it from /world-intros/), only without a content hash.
    return file ? withContentHash(`/api/worlds/intro-avatar?${query}&n=${index}`, file) : null;
  });
}

export async function readWorldShelf(repoRoot: string, activeRoot?: string) {
  // Saves come from the CURRENT user's root; templates are
  // shared and stay where they are. `local` resolves to `<repo>/worlds`, so a
  // developer with no account env sees exactly what they saw before. Published
  // workshop worlds are shared too, from their own root.
  const savesRoot = worldsRoot(repoRoot);
  const [allTemplates, worlds, published] = await Promise.all([entries(path.join(repoRoot, 'templates')), entries(savesRoot), entries(publishedRoot(repoRoot))]);
  // `world.json` `exp: true` marks an experimental sandbox (templates/fpal). It
  // is deliberately NOT an edition, so it is kept out of the `templates`
  // edition-id list the edition gates compare against — but it stays in
  // `groups`, because the whole point is that a human can open it from the
  // Launcher. A sandbox only exists if it is visible AND does not redden the
  // edition corpus, so both halves belong here.
  const templates = allTemplates.filter(t => t.manifest.exp !== true);
  const expTemplates = allTemplates.filter(t => t.manifest.exp === true);
  // Cover URLs carry the file's content hash (`h=`), so the launcher's covers
  // are immutable in the browser and shared by editions that ship the same
  // picture. The route still resolves by id.
  const coverUrl = async (dir: string, rel: string | null, url: string) => rel ? withContentHash(url, path.join(dir, rel)) : null;
  const covers = new Map(await Promise.all(allTemplates.map(async t => {
    const dir = path.join(repoRoot, 'templates', t.id);
    return [t.id, await coverUrl(dir, await coverOf(dir, t.manifest), `/api/worlds/cover?id=${encodeURIComponent(t.id)}`)] as const;
  })));
  const videos = new Map(await Promise.all(allTemplates.map(async t => {
    const dir = path.join(repoRoot, 'templates', t.id);
    return [t.id, await coverUrl(dir, await coverVideoOf(dir, t.manifest), `/api/worlds/cover?id=${encodeURIComponent(t.id)}&kind=video`)] as const;
  })));
  // Editions that ship the same picture share ONE URL: the first template with
  // that hash names it, so the browser downloads it once, not once per edition.
  const canonical = (urls: Map<string, string | null>) => {
    const byHash = new Map<string, string>();
    for (const [id, url] of [...urls].sort(([a], [b]) => a.localeCompare(b))) {
      const hash = url?.match(/[?&]h=([0-9a-f]{32})/)?.[1];
      if (!url || !hash) continue;
      if (byHash.has(hash)) urls.set(id, byHash.get(hash)!);
      else byHash.set(hash, url);
    }
  };
  canonical(covers);
  canonical(videos);
  const intros = new Map(await Promise.all(allTemplates.map(async t =>
    [t.id, await introOf(path.join(repoRoot, 'templates', t.id), t.manifest, `id=${encodeURIComponent(t.id)}`)] as const)));
  const groups = new Map<string, ShelfGroup>(allTemplates.map(t => [t.id, {
    id: t.id,
    name: String(t.manifest.name || t.id),
    templatePath: `templates/${t.id}`,
    cover: covers.get(t.id) ?? null,
    coverVideo: videos.get(t.id) ?? null,
    locale: text(t.manifest.locale) || null,
    description: text(t.manifest.description),
    exp: t.manifest.exp === true,
    intro: intros.get(t.id),
    category: worldCategoryIdOf(t.manifest),
    saves: [],
    place: { kind: 'official', pending: false, conflict: false },
  }]));
  // Published workshop worlds behave like templates: a brick, a cover, "start a
  // new game" copies them. Only a made world (`workshop` block, id = dir name)
  // is honoured here, so a stray directory in the shared root cannot pose as one.
  const me = userId();
  for (const entry of published) {
    const meta = workshopOf(entry.manifest);
    if (!meta || entry.manifest.id !== entry.id) continue;
    const publishedDir = path.join(publishedRoot(repoRoot), entry.id);
    const cover = await coverUrl(publishedDir, await coverOf(publishedDir, entry.manifest), `/api/worlds/cover?published=${encodeURIComponent(entry.id)}`);
    groups.set(entry.id, {
      id: entry.id,
      name: String(entry.manifest.name || entry.id),
      templatePath: `published/${entry.id}`,
      cover,
      coverVideo: null,
      locale: text(entry.manifest.locale) || null,
      description: text(entry.manifest.description),
      exp: false,
      workshop: { ...meta, status: 'published', mine: meta.owner === me, editPath: null },
      intro: await introOf(publishedDir, entry.manifest, `published=${encodeURIComponent(entry.id)}`),
      category: worldCategoryIdOf(entry.manifest),
      saves: [],
      place: { kind: 'cloud', pending: false, conflict: false },
    });
  }
  for (const save of worlds) {
    const meta = workshopOf(save.manifest);
    const groupId = shelfGroupIdOf(save.id, save.manifest, allTemplates);
    if (!groups.has(groupId)) groups.set(groupId, { id: groupId, name: String(save.manifest.name || groupId), templatePath: null, cover: null, coverVideo: null, locale: text(save.manifest.locale) || null, description: text(save.manifest.description), exp: save.manifest.exp === true, category: worldCategoryIdOf(save.manifest), saves: [], place: { kind: 'local', pending: false, conflict: false } });
    const group = groups.get(groupId)!;
    if (meta) {
      const original = save.id === save.manifest.id;
      // A draft is filed by the author's latest choice (their original save) until it is published.
      if (original && group.workshop?.status !== 'published') group.category = worldCategoryIdOf(save.manifest) ?? group.category;
      const mine = meta.owner === me;
      // The author's original is the draft: it shows the brick even before the
      // world is published, with its own cover, and it is what "open" edits.
      if (original && !group.cover) {
        const saveDir = path.join(savesRoot, save.id);
        const cover = await coverUrl(saveDir, await coverOf(saveDir, save.manifest), `/api/worlds/cover?save=${encodeURIComponent(save.id)}`);
        if (cover) group.cover = cover;
      }
      const current = group.workshop;
      group.workshop = {
        ...(current ?? meta),
        status: current?.status === 'published' ? 'published' : meta.status,
        mine: current?.mine || mine,
        editPath: original && mine ? `worlds/${save.id}` : current?.editPath ?? null,
      };
    }
    // Only the author's original can be kept in the cloud; every play copy lives on this device.
    const authored = meta && save.id === save.manifest.id && meta.owner === me;
    const place = authored ? await placeOf(path.join(savesRoot, save.id), save.manifest) : LOCAL_PLACE;
    if (authored) group.place = { kind: place.location, pending: place.pending, conflict: place.conflict };
    group.saves.push({ id: save.id, path: `worlds/${save.id}`, updatedAt: save.updatedAt, active: activeRoot ? path.resolve(activeRoot) === path.join(savesRoot, save.id) : false, place });
  }
  for (const group of groups.values()) group.saves.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    templates: templates.map(t => t.id),
    expTemplates: expTemplates.map(t => t.id),
    worlds: worlds.map(w => w.id),
    groups: [...groups.values()],
  };
}

/** Delete means recoverable rename, never recursive removal. */
export async function trashWorldSave(repoRoot: string, worldPath: unknown, activeRoot?: string) {
  if (typeof worldPath !== 'string' || !/^worlds\/[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(worldPath)) throw new ShelfError(400, 'Expected a saved world path.');
  // Deleting resolves inside the current user's root: the `worlds/<id>` a
  // client sends is an id, not a filesystem location.
  const root = await fs.realpath(worldsRoot(repoRoot));
  const target = path.join(root, worldPath.slice('worlds/'.length));
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink() || await fs.realpath(target) !== target) throw new ShelfError(404, 'Save not found.');
  if (activeRoot && await fs.realpath(activeRoot).catch(() => path.resolve(activeRoot)) === target) throw new ShelfError(409, 'Open another save before deleting the current one.');
  await fs.access(path.join(target, 'world.json'));
  const trash = path.join(root, '.trash');
  await fs.mkdir(trash, { recursive: true });
  if (await fs.realpath(trash) !== trash) throw new ShelfError(400, 'Invalid trash directory.');
  const destination = path.join(trash, `${path.basename(target)}-${randomUUID()}`);
  await fs.rename(target, destination);
  return { ok: true, recoveryPath: path.relative(repoRoot, destination) };
}
