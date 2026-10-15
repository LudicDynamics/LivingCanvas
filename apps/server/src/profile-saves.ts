import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCgLog, parseFrontmatter } from '@airp/shared';
import { worldsRoot } from './engine/user-root.js';
import { workshopOf } from './world-workshop.js';

/**
 * The 个人页面's device half: what each save on this
 * computer (the current user's save root) records about how it was played —
 * read from files only, never by opening a save's SQLite or touching the
 * active store, so it is safe while a world is running and cheap enough to
 * read whenever the page opens.
 *
 *   world.json            name, locale, mode, how many endings / mysteries the world has, workshop block
 *   world/README.md       status.data.ending (+ endingTurn), status.data.debrief, cg_log, art.cg
 *
 * Spoilers: an ending's title is returned only for the ending this save
 * reached; the others are a count. CGs are the ones this save has shown.
 */

export interface ProfileSave {
  saveId: string;
  /** world.json `id` (the edition a template save came from, or a made world's own id). */
  manifestId: string;
  name: string;
  locale: string | null;
  mode: 'open' | 'semi' | 'closed';
  /** When the save directory was made (ISO), when the platform knows it. */
  createdAt: string | null;
  updatedAt: string;
  endingsTotal: number;
  ending: { id: string; title: string; at: string | null } | null;
  /** The 复盘: how many of the world's mysteries the answers unlocked (null = not answered / none). */
  debrief: { unlocked: number; total: number; at: string | null } | null;
  mysteriesTotal: number;
  /** The CGs this save has shown, oldest first. */
  cgs: { path: string; caption: string | null; at: string | null }[];
  /** Declared CGs (README `art.cg`) whose picture is in the save: the world's gallery size. */
  cgTotal: number;
  workshop: { status: 'draft' | 'published'; owner: string; createdAt: string; publishedAt: string | null } | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const SAVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const isoOf = (ms: number) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The README frontmatter of a save, or {} (missing / unreadable). */
async function readmeOf(dir: string): Promise<{ fm: Record<string, unknown>; mtime: number }> {
  try {
    const file = path.join(dir, 'world', 'README.md');
    const [raw, st] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    return { fm: parseFrontmatter(raw).frontmatter ?? {}, mtime: st.mtimeMs };
  } catch {
    return { fm: {}, mtime: 0 };
  }
}

const exists = (file: string) => fs.access(file).then(() => true, () => false);

/** One save directory → its record, or null when it is not a save. Exported for tests. */
export async function readProfileSave(dir: string, saveId: string): Promise<ProfileSave | null> {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(dir, 'world.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!isRecord(manifest) || typeof manifest.id !== 'string') return null;
  const mode = manifest.mode === 'closed' || manifest.mode === 'semi' ? manifest.mode : 'open';
  const endings = (Array.isArray(manifest.endings) ? manifest.endings : []).filter((e): e is Record<string, unknown> => isRecord(e) && typeof e.id === 'string');
  const mysteries = Array.isArray(manifest.mysteries) ? manifest.mysteries.length : 0;
  const { fm, mtime } = await readmeOf(dir);
  const status = isRecord(fm.status) ? fm.status : {};
  const data = isRecord(status.data) ? status.data : {};

  const debriefRaw = isRecord(data.debrief) ? data.debrief : null;
  const debriefAt = text(debriefRaw?.at);
  const debrief = debriefRaw && mysteries > 0
    ? { unlocked: Array.isArray(debriefRaw.unlocked) ? debriefRaw.unlocked.filter((x) => typeof x === 'string').length : 0, total: mysteries, at: debriefAt }
    : null;

  let ending: ProfileSave['ending'] = null;
  const endingId = mode !== 'open' && typeof data.ending === 'string' ? data.ending : null;
  const declared = endingId ? endings.find((e) => e.id === endingId) : null;
  if (declared) {
    // After an ending only talk and the debrief write the README, so its time is the ending's
    // unless the debrief came later (then the debrief's own time is an upper bound too).
    const readmeAt = isoOf(mtime);
    const at = [readmeAt, debriefAt].filter((x): x is string => !!x).sort()[0] ?? null;
    ending = { id: String(declared.id), title: text(declared.title) ?? String(declared.id), at };
  }

  const cgs = parseCgLog(fm.cg_log).map((e) => ({ path: e.path, caption: e.caption ?? null, at: e.at || null }));
  const art = isRecord(fm.art) ? fm.art : {};
  const declaredCg = (Array.isArray(art.cg) ? art.cg : []).map((e) => (isRecord(e) && typeof e.path === 'string' ? e.path.trim() : '')).filter((p) => /^assets\//.test(p) && !p.includes('..'));
  const present = await Promise.all([...new Set(declaredCg)].map(async (p) => ((await exists(path.join(dir, p))) ? p : null)));
  const gallery = new Set([...present.filter((p): p is string => !!p), ...cgs.map((c) => c.path)]);

  const times = await Promise.all(['world.json', '.airpworld/history.db', '.airpworld/history.db-wal', '.airpworld/canvas.db', '.airpworld/canvas.db-wal'].map((f) => fs.stat(path.join(dir, f)).then((s) => s.mtimeMs).catch(() => 0)));
  const dirStat = await fs.stat(dir).catch(() => null);
  const born = dirStat ? (dirStat.birthtimeMs > 0 ? dirStat.birthtimeMs : dirStat.ctimeMs) : 0;
  const meta = workshopOf(manifest);

  return {
    saveId,
    manifestId: manifest.id,
    name: text(manifest.name) ?? manifest.id,
    locale: text(manifest.locale),
    mode,
    createdAt: isoOf(born),
    updatedAt: isoOf(Math.max(...times, mtime)) ?? new Date(0).toISOString(),
    endingsTotal: endings.length,
    ending,
    debrief,
    mysteriesTotal: mysteries,
    cgs,
    cgTotal: gallery.size,
    workshop: meta ? { status: meta.status, owner: meta.owner, createdAt: meta.createdAt, publishedAt: meta.publishedAt ?? null } : null,
  };
}

/** Every save in the current user's root (hidden / trashed directories skipped), newest first. */
export async function readProfileSaves(repoRoot: string): Promise<ProfileSave[]> {
  const root = worldsRoot(repoRoot);
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const saves = await Promise.all(dirs
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && SAVE_ID.test(d.name) && d.name !== 'users')
    .map((d) => readProfileSave(path.join(root, d.name), d.name).catch(() => null)));
  return saves.filter((s): s is ProfileSave => s !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The save root to serve a CG this save has SHOWN from, or null. Only pictures in the
 * save's own `cg_log` are served — the gallery never becomes a way to look at
 * a world's unseen pictures.
 */
export async function shownCgRoot(repoRoot: string, saveId: unknown, rel: unknown): Promise<string | null> {
  if (typeof saveId !== 'string' || !SAVE_ID.test(saveId) || typeof rel !== 'string' || !rel) return null;
  const dir = path.join(worldsRoot(repoRoot), saveId);
  const { fm } = await readmeOf(dir);
  if (!parseCgLog(fm.cg_log).some((e) => e.path === rel)) return null;
  return dir;
}
