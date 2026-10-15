/**
 * The current page, already opened for the writer.
 *
 * Measured on a real save (seven-days-inn, 164 beats): one beat in seven began
 * with read / look_at / ls on the page the player was standing on, and each
 * such round trip cost 2–4 s before anything reached the canvas. The state
 * block only carries one-line summaries (`layer_files`, 90 characters each), so
 * the writer — told never to narrate from an index line — opened the files
 * first. This block hands it the files themselves, once, at the turn boundary.
 *
 * Bounded: a total character budget and a per-file cap, filled in order of
 * importance (the page's own README → interactive entities → other cards →
 * narration, newest first). What does not fit is listed by path, never
 * silently dropped, so the writer knows what it has NOT seen.
 *
 * Writer only, and ephemeral like the rest of the block (extensions/context.ts):
 * it rides the first provider request of the turn and is never persisted, so
 * the session transcript — the cached prefix — does not grow by it.
 */
import type { LocalWorldStore } from '../store/local-store.js';
import { cardsOfLayer, dirOfLayer } from '../store/layers.js';
import { isPlayerNotePath } from '../rules/player-notes.js';
import { isHtmlPath } from '../rules/html-head.js';
import { parseFrontmatter } from '../schemas/frontmatter.js';

/** One file offered to the block: path + raw text. */
export interface WriterPageFile {
  path: string;
  raw: string;
}

export interface WriterPagesOptions {
  /** Total characters of file text across the block. */
  budget: number;
  /** Characters of any single file before it is cut. */
  perFile: number;
}

export const WRITER_PAGES_DEFAULTS: WriterPagesOptions = { budget: 8000, perFile: 2000 };

/** The block's first line. Frozen: tests and the writer instructions refer to it. */
export const WRITER_PAGES_HEADER = '[This page, already opened for you]';

/**
 * Budget from the environment: `AIRP_WRITER_PAGES=0` turns the block off
 * (returns null); `AIRP_WRITER_PAGES_BUDGET` / `AIRP_WRITER_PAGES_PER_FILE`
 * override the caps. Garbage falls back to the defaults.
 */
export function writerPagesOptionsFromEnv(env: Record<string, string | undefined>): WriterPagesOptions | null {
  const flag = (env.AIRP_WRITER_PAGES ?? '').trim().toLowerCase();
  if (flag === '0' || flag === 'off' || flag === 'false') return null;
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  const budget = num(env.AIRP_WRITER_PAGES_BUDGET, WRITER_PAGES_DEFAULTS.budget);
  if (budget === 0) return null;
  return { budget, perFile: Math.max(200, num(env.AIRP_WRITER_PAGES_PER_FILE, WRITER_PAGES_DEFAULTS.perFile)) };
}

/** What a file is, for ordering. */
function kindOf(file: WriterPageFile): { chalk: boolean; interactive: boolean } {
  const fm = (parseFrontmatter(file.raw).frontmatter ?? {}) as Record<string, unknown>;
  const type = typeof fm.type === 'string' ? fm.type : '';
  return {
    chalk: type === 'chalk',
    interactive: Boolean(fm.choice || fm.roll_dice || fm.status || type === 'gate' || type === 'item'),
  };
}

/** Leading ordinal of a basename (`07-rain.md` → 7), -1 when none. */
function ordinal(p: string): number {
  const m = /^(\d+)/.exec(p.slice(p.lastIndexOf('/') + 1));
  return m ? Number(m[1]) : -1;
}

/** How many of the newest narration cards outrank everything but the README. */
const LATEST_CHALK = 2;

/**
 * Text that cannot forge the block's own structure: control characters other
 * than newline/tab are dropped, and a line that would read as a file fence is
 * indented so it stays content.
 */
function neutralise(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/^(===|\[This page)/gm, ' $1');
}

/** A path safe to print on one fence line. */
function safePath(p: string): string {
  return p.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
}

/**
 * Order files by importance: the README (the page itself, its intent), the
 * newest narration (what the writer continues from), interactive entities
 * (choices, dice, states, gates, items), other cards, then older narration
 * newest first. Ties keep path order so the block is stable turn to turn.
 */
export function orderWriterPages(files: readonly WriterPageFile[], readmePath: string): WriterPageFile[] {
  const kinds = new Map(files.map((f) => [f.path, kindOf(f)]));
  const byRecency = (a: WriterPageFile, b: WriterPageFile) => ordinal(b.path) - ordinal(a.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const latest = new Set(
    files.filter((f) => f.path !== readmePath && kinds.get(f.path)!.chalk && ordinal(f.path) >= 0)
      .sort(byRecency)
      .slice(0, LATEST_CHALK)
      .map((f) => f.path),
  );
  const rank = (f: WriterPageFile): number => {
    if (f.path === readmePath) return 0;
    if (latest.has(f.path)) return 1;
    const k = kinds.get(f.path)!;
    if (k.interactive) return 2;
    if (!k.chalk) return 3;
    return 4;
  };
  return [...files].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return rank(a) === 1 || rank(a) === 4 ? byRecency(a, b) : a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/**
 * Render the block. Pure, total. Returns '' when there is nothing to show.
 * `files` must already be in importance order (`orderWriterPages`).
 */
export function renderWriterPages(layer: string, files: readonly WriterPageFile[], opts: WriterPagesOptions): string {
  if (files.length === 0) return '';
  const parts: string[] = [];
  const left: string[] = [];
  let used = 0;
  for (const file of files) {
    const remaining = opts.budget - used;
    // A file needs room for at least a meaningful head; otherwise list it.
    if (remaining < Math.min(200, opts.perFile)) {
      left.push(safePath(file.path));
      continue;
    }
    const cap = Math.min(opts.perFile, remaining);
    const text = neutralise(file.raw).trim();
    const cut = text.length > cap;
    const body = cut ? `${text.slice(0, cap).trimEnd()}\n… [cut here — read ${safePath(file.path)} for the rest]` : text;
    used += Math.min(text.length, cap);
    parts.push(`=== ${safePath(file.path)} ===\n${body}`);
  }
  if (parts.length === 0) return '';
  const lines = [
    WRITER_PAGES_HEADER,
    `The files on the player's current page (${safePath(layer)}) as they are at the start of this turn. They count as opened: do not read or look_at them again — only a file marked "cut here", or one not shown, needs opening.`,
    ...parts,
  ];
  if (left.length > 0) lines.push(`Not shown (over budget) — open them if this turn touches them: ${left.join(', ')}`);
  return lines.join('\n\n');
}

/**
 * Turn-boundary read for the writer: the page's README plus its direct cards
 * (player notes excluded — they belong to the board; `.html` cards listed by
 * path only, their source is not prose). Reads only what `cardsOfLayer`
 * derives, so a page renders exactly the files the player sees.
 */
export async function collectWriterPages(store: LocalWorldStore, layer: string, opts: WriterPagesOptions): Promise<string> {
  const dir = dirOfLayer(layer);
  const readme = `${dir}/README.md`;
  const all = await store.listFiles();
  const paths = [
    ...(all.includes(readme) ? [readme] : []),
    ...cardsOfLayer(layer, all).filter((p) => !isPlayerNotePath(p)),
  ];
  const files: WriterPageFile[] = [];
  for (const p of paths) {
    if (isHtmlPath(p)) {
      files.push({ path: p, raw: '(an HTML card — open it with look_at if this turn touches it)' });
      continue;
    }
    try {
      files.push({ path: p, raw: await store.readFile(p) });
    } catch {
      // Unreadable now: say nothing rather than guess; the summary row in
      // `layer_files` still lists it.
    }
  }
  return renderWriterPages(layer, orderWriterPages(files, readme), opts);
}
