/**
 * Reference location + rewrite (doc 04 §3.6). The interface (`RefSite` /
 * `RefKind` / `DanglingRef` / `relFrom` / `resolveRefTarget`) is frozen by
 * 01 §6.2; this file is the single implementation, owned by doc 04.
 *
 * The core defect this replaces: `content.replaceAll(from, to)` treats a
 * reference as a string occurrence. It rewrites substrings (`key.md.bak`), it
 * silently edits narrative prose (a bare `key.md` mention), and it cannot say
 * why a reference is dangling. The fix is to locate references as spans with
 * character offsets (pass 1) and rewrite only at those offsets (pass 2).
 */
import type { WorldStore } from '../store/world-store.js';
import type { DanglingRef } from '../schemas/events.js';

export type { DanglingRef };

/**
 * Reference kinds. `link_to` / `append_to` were dropped (02 §9.5 / 04 §3.6.3,
 * adjudicated in the review): they are `chalk` tool parameters, not persistent
 * frontmatter keys, so nothing in the world ever holds one.
 */
export type RefKind =
  | 'frontmatter-path' // a YAML key that explicitly names a path
  | 'gate-target' // gate frontmatter target
  | 'markdown-link' // [text](path)
  | 'asset-ref' // ![alt](path) / bg: path / <img src> / world.json leaf
  | 'body-mention'; // a bare basename in prose — NEVER auto-rewritten

/** One located reference. `start/end` are char offsets into the file's raw text. */
export interface RefSite {
  file: string;
  kind: RefKind;
  /** Normalized world-relative path, or bare basename for a body-mention. */
  target: string;
  start: number;
  end: number;
  /** Original slice (for exact replacement + style preservation). */
  raw: string;
}

export interface RewriteResult {
  rewrote: string[];
  dangling: DanglingRef[];
}

/** Frontmatter keys whose scalar/list value names a world path (04 §3.6.3). */
const PATH_KEYS = ['path', 'src', 'bg', 'background', 'ref', 'home', 'target'] as const;

/** Files worth scanning: markdown entities plus manifest/config files (04 §3.6.2). */
export function isCandidate(file: string): boolean {
  return (
    file.endsWith('.md') ||
    file === 'world.json' ||
    file.endsWith('.json') ||
    file.endsWith('.yml') ||
    file.endsWith('.yaml')
  );
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/** POSIX join of a directory and a (possibly relative) reference. Never path.join. */
function posixResolve(dir: string, ref: string): string {
  const segs = (dir === '' ? [] : dir.split('/')).concat(ref.split('/'));
  const out: string[] = [];
  for (const s of segs) {
    if (s === '' || s === '.') continue;
    if (s === '..') {
      out.pop();
      continue;
    }
    out.push(s);
  }
  return out.join('/');
}

/**
 * POSIX relative path from `dir` to `target`; './'-prefixed when same-dir.
 * NEVER `path.relative` (Windows backslashes, 04 §3.6.5).
 */
export function relFrom(dir: string, target: string): string {
  const from = dir === '' ? [] : dir.split('/');
  const to = target.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = from.slice(i).map(() => '..');
  const down = to.slice(i);
  if (up.length === 0) return `./${down.join('/')}`;
  return up.concat(down).join('/');
}

/** Was this reference written as world-root absolute (`/x` or `world/…`)? */
function isRootAbsolute(raw: string): boolean {
  const ref = normalizeRef(raw);
  return ref.startsWith('/') || /^(world|player|characters)(\/|$)/.test(ref);
}

/**
 * Is this reference a URL rather than a world path? (契约 §6.10)
 * Hits: any scheme (`data:` / `http:` / `https:` / `mailto:` / `tel:` /
 * `javascript:` / `blob:` / `file:` / …) and protocol-relative `//…`.
 * Misses: every path shape (relative, root-absolute, world-relative).
 *
 * Deliberately narrow: it answers "is this URL-like", never "is this path
 * well-formed" — malformed paths stay with the rest of this module.
 */
export function isNonPathRef(raw: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//');
}

/** Strip `<...>` wrapping, URL-decode, and drop `#fragment` / `?query`. */
export function normalizeRef(raw: string): string {
  let ref = raw.trim();
  if (ref.startsWith('<') && ref.endsWith('>')) ref = ref.slice(1, -1);
  const hash = ref.indexOf('#');
  if (hash !== -1) ref = ref.slice(0, hash);
  const q = ref.indexOf('?');
  if (q !== -1) ref = ref.slice(0, q);
  try {
    ref = decodeURIComponent(ref);
  } catch {
    // A malformed escape stays as-is; the target simply will not match.
  }
  return ref;
}

/**
 * Pure resolver: is `ref` a path (absolute-in-world or relative to `currentFile`)?
 * Unambiguous? Returns the normalized world-relative path, or null when the
 * reference cannot be resolved to exactly one file (01 §6.2 / 04 §3.6.3).
 *
 * Exact path-segment comparison — never `includes`: `world/inn/key.md.bak`,
 * `world/inn/key.mdX` and `world/in/key.md` all fail to match.
 */
export function resolveRefTarget(ref: string, currentFile: string, allFiles: Set<string>): string | null {
  const norm = normalizeRef(ref);
  if (norm === '') return null;

  if (norm.startsWith('/')) {
    const abs = norm.replace(/^\/+/, '');
    return abs === '' ? null : abs;
  }
  // `world/…`, `player/…`, `characters/…` are world-root RELATIVE (00 §2.1),
  // and frontmatter path keys are always written that way (04 §3.6.5). They
  // must not be glued onto the current file's directory.
  if (/^(world|player|characters)\//.test(norm)) return norm;
  if (norm.startsWith('./') || norm.startsWith('../') || norm.includes('/')) {
    return posixResolve(dirname(currentFile), norm);
  }
  // Bare basename: unambiguous only when exactly one file carries it.
  const matches: string[] = [];
  for (const f of allFiles) {
    if (basename(f) === norm) matches.push(f);
  }
  return matches.length === 1 ? matches[0] : null;
}

/** Regex-equivalent boundary check for a bare mention (04 §3.6.4). */
const MENTION_TOKEN = /[A-Za-z0-9_./\\-]/;

function spansOverlap(spans: Array<{ start: number; end: number }>, start: number, end: number): boolean {
  return spans.some((s) => start < s.end && end > s.start);
}

/** Frontmatter block split (same regex as frontmatter.ts §8.1). */
const FM_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Pure: locate every frontmatter-path / link / asset span in one file's raw
 * text (04 §8.1 `extractRefSpans`). No I/O, no target resolution — the caller
 * decides which sites actually point at the moved file.
 *
 * `movedBase` is the basename of the entity being moved; body-mentions are
 * derived from it, so a candidate file's own name never produces a mention.
 */
export function extractRefSpans(raw: string, filename: string, movedBase = filename): RefSite[] {
  const sites: RefSite[] = [];
  const fmMatch = raw.match(FM_BLOCK);
  const fmEnd = fmMatch ? fmMatch[0].length : 0;

  // --- frontmatter path keys ---
  if (fmMatch) {
    const block = fmMatch[1];
    const isGate = /^\s*type:\s*['"]?gate['"]?\s*$/m.test(block) || filename.endsWith('README.md');
    // The declared `type:` scalar, used to tell a sprite's character id from a
    // real path in the `target` key.
    const declaredType = block.match(/^\s*type:\s*['"]?([\w-]+)['"]?\s*$/m)?.[1];
    let activeKey: string | null = null;
    let offset = fmMatch[0].indexOf('\n') + 1; // past the leading '---\n'
    for (const line of block.split('\n')) {
      const lineLen = line.length + 1;
      const kv = line.match(/^(\s*)([A-Za-z_][\w-]*):\s*(.*)$/);
      if (kv) {
        const key = kv[2];
        const value = kv[3].trim();
        activeKey = (PATH_KEYS as readonly string[]).includes(key) ? key : null;
        if (activeKey && value !== '' && !value.startsWith('|') && !value.startsWith('>')) {
          // (§3.6.3) A gate/README `target` is a `gate-target`; on a `sprite`
          // (or `type: character`) it is a character id, and rewriting `watson`
          // would corrupt the cast. Every other `target` — and every other
          // PATH_KEYS key — names a real path.
          const isCharTarget = declaredType === 'sprite' || declaredType === 'character';
          const kind: RefKind | null =
            activeKey === 'target' ? (isGate ? 'gate-target' : isCharTarget ? null : 'frontmatter-path') : 'frontmatter-path';
          if (kind) {
            const valueStart = offset + line.length - value.length;
            sites.push({
              file: filename,
              kind,
              target: value,
              start: valueStart,
              end: valueStart + value.length,
              raw: value,
            });
          }
        }
      } else if (activeKey && activeKey !== 'target' && /^\s*-\s+/.test(line)) {
        const item = line.replace(/^\s*-\s+/, '');
        const itemStart = offset + line.length - item.length;
        sites.push({
          file: filename,
          kind: 'frontmatter-path',
          target: item,
          start: itemStart,
          end: itemStart + item.length,
          raw: item,
        });
      }
      offset += lineLen;
    }
  }

  // --- body: markdown links, images, HTML ---
  const body = raw.slice(fmEnd);
  const inlineLink = /(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (let m = inlineLink.exec(body); m !== null; m = inlineLink.exec(body)) {
    const dest = m[2];
    if (isNonPathRef(dest)) continue;
    const destStart = fmEnd + m.index + m[0].indexOf(dest);
    sites.push({
      file: filename,
      kind: m[1] === '!' ? 'asset-ref' : 'markdown-link',
      target: dest,
      start: destStart,
      end: destStart + dest.length,
      raw: dest,
    });
  }
  const htmlRef = /<(?:img|a)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi;
  for (let m = htmlRef.exec(body); m !== null; m = htmlRef.exec(body)) {
    const dest = m[1];
    if (isNonPathRef(dest)) continue;
    const destStart = fmEnd + m.index + m[0].lastIndexOf(dest);
    sites.push({ file: filename, kind: 'asset-ref', target: dest, start: destStart, end: destStart + dest.length, raw: dest });
  }

  // --- body mentions of the moved basename (never rewritten, §3.6.4) ---
  const base = basename(movedBase);
  const noExt = base.replace(/\.md$/, '');
  for (const token of base === noExt ? [base] : [base, noExt]) {
    let idx = body.indexOf(token);
    while (idx !== -1) {
      const before = idx === 0 ? '' : body[idx - 1];
      const after = idx + token.length >= body.length ? '' : body[idx + token.length];
      const start = fmEnd + idx;
      const end = start + token.length;
      const bounded =
        !MENTION_TOKEN.test(before) && !MENTION_TOKEN.test(after) && !spansOverlap(sites, start, end);
      if (bounded) {
        sites.push({ file: filename, kind: 'body-mention', target: token, start, end, raw: token });
      }
      idx = body.indexOf(token, idx + token.length);
    }
  }

  return sites;
}

/** String leaves of a parsed JSON value, with the JSON pointer path. */
function jsonStringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(jsonStringLeaves);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(jsonStringLeaves);
  }
  return [];
}

/**
 * Pass 1: locate every site that points at `from` (or its bare basename).
 * Read-only (04 §3.6.2 / §3.6.3). `to` is unused: scanning happens before the
 * rename, and the recorded offsets are what pass 2 rewrites.
 */
export async function scanRefs(store: WorldStore, from: string, to: string): Promise<RefSite[]> {
  void to;
  const allFiles = new Set(await store.listFiles());
  const files = [...allFiles].filter(isCandidate);
  const base = basename(from);
  const noExt = base.replace(/\.md$/, '');
  const sites: RefSite[] = [];

  for (const file of files) {
    // The moved file's own body is step 7's job (`scanOwnRefs` /
    // `rewriteOwnRefs`, §3.6.6) — it no longer exists at `from` once renamed.
    if (file === from) continue;
    let raw: string;
    try {
      raw = await store.readFile(file);
    } catch {
      continue; // unreadable candidates are reported by rewriteRefs when cited
    }
    // Cheap prefilter — deliberately looser than the real judgement (a file that
    // mentions the basename at all still gets the exact scan). Skipping on a
    // prefilter miss is safe only because it is strictly wider than the match.
    if (!raw.includes(base) && !raw.includes(noExt) && !raw.includes(from)) continue;

    if (file.endsWith('.json')) {
      // §3.6.7 (world.json and any config JSON): string leaves exactly equal to
      // `from`. Reuses `asset-ref` so the frozen RefKind enum gains no value;
      // rewriting re-serializes so a patched leaf stays valid JSON.
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      for (const leaf of jsonStringLeaves(parsed)) {
        if (leaf !== from) continue;
        const quoted = JSON.stringify(leaf);
        const start = raw.indexOf(quoted) + 1;
        sites.push({ file, kind: 'asset-ref', target: leaf, start, end: start + leaf.length, raw: leaf });
      }
      continue;
    }

    // Candidates in `.yml` / `.yaml` are text-scanned like markdown; a mention
    // is only ever counted for the file being moved.
    for (const site of extractRefSpans(raw, file, from)) {
      if (site.kind === 'body-mention') {
        sites.push(site);
        continue;
      }
      if (file.endsWith('.md') || file.endsWith('.yml') || file.endsWith('.yaml')) {
        if (resolveRefTarget(site.target, file, allFiles) === from) sites.push(site);
      }
    }
  }
  return sites;
}

/** Recompute the replacement string for one site, or null when it must stay. */
function buildReplacement(site: RefSite, to: string, file: string): string | null {
  switch (site.kind) {
    case 'body-mention':
      return null; // narrative prose is never rewritten (01 §6.3 #2)
    case 'frontmatter-path':
    case 'gate-target': {
      // Frontmatter path keys are always world-root relative (00 §2.1); keep
      // the original quote style if any.
      const q = /^["']/.test(site.raw) ? site.raw[0] : '';
      return `${q}${to}${q}`;
    }
    case 'markdown-link':
    case 'asset-ref': {
      if (file.endsWith('.json')) return to; // world.json leaf: root-relative
      // Style is never changed silently: relative stays relative, absolute
      // stays absolute (04 §3.6.5).
      return isRootAbsolute(site.raw) ? to : relFrom(dirname(file), to);
    }
  }
}

/** Pass 2: rewrite ONLY at the recorded offsets. Never `replaceAll`/bare `includes`. */
export async function rewriteRefs(
  store: WorldStore,
  from: string,
  to: string,
  sites: RefSite[]
): Promise<RewriteResult> {
  const byFile = new Map<string, RefSite[]>();
  for (const site of sites) {
    const list = byFile.get(site.file);
    if (list) list.push(site);
    else byFile.set(site.file, [site]);
  }

  const rewrote: string[] = [];
  const dangling: DanglingRef[] = [];
  for (const [file, list] of byFile) {
    let raw: string;
    try {
      raw = await store.readFile(file);
    } catch {
      for (const site of list) dangling.push({ file, target: site.target, reason: 'unreadable' });
      continue;
    }
    if (file.endsWith('.json')) {
      // JSON is rewritten as DATA, never by offsets. The scan locates a leaf
      // with `indexOf`, so a path that appears twice (a debrief clue cited by
      // two options) got two sites at the same offset; patching both corrupted
      // world.json (a live last-train save: "Bad control character … line 99",
      // every later move then failed with 500). Replace every leaf equal to
      // `from` and re-serialize; if the file does not parse, leave it untouched.
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        for (const site of list) dangling.push({ file, target: site.target, reason: 'unreadable' });
        continue;
      }
      let hits = 0;
      const swap = (value: unknown): unknown => {
        if (value === from) { hits += 1; return to; }
        if (Array.isArray(value)) return value.map(swap);
        if (value && typeof value === 'object') {
          return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, swap(v)]));
        }
        return value;
      };
      const next = swap(parsed);
      if (hits === 0) continue;
      await store.writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n');
      rewrote.push(file);
      continue;
    }
    let changed = false;
    // Back-to-front so earlier offsets survive the length changes.
    for (const site of [...list].sort((a, b) => b.start - a.start)) {
      const replacement = buildReplacement(site, to, file);
      if (replacement === null) {
        dangling.push({ file, target: site.target, reason: 'ambiguous' });
        continue;
      }
      raw = raw.slice(0, site.start) + replacement + raw.slice(site.end);
      changed = true;
    }
    if (!changed) continue;
    await store.writeFileAtomic(file, raw);
    rewrote.push(file);
  }
  return { rewrote, dangling };
}

/**
 * Pass 1 for the moved file's OWN body (04 §3.6.6, step 7). Only markdown
 * links / asset refs — frontmatter path keys are already root-relative.
 */
export async function scanOwnRefs(store: WorldStore, selfPath: string, oldDir: string): Promise<RefSite[]> {
  void oldDir;
  let raw: string;
  try {
    raw = await store.readFile(selfPath);
  } catch {
    return [];
  }
  return extractRefSpans(raw, selfPath).filter(
    (s) => s.kind === 'markdown-link' || s.kind === 'asset-ref'
  );
}

/**
 * Pass 2 for the moved file's own relative references: re-base each relative
 * target from `oldDir` to `newDir`. Root-absolute references are untouched.
 * Never reports dangling — self-rebasing is part of the move, not a broken edge.
 */
export async function rewriteOwnRefs(
  store: WorldStore,
  selfPath: string,
  oldDir: string,
  newDir: string,
  sites: RefSite[]
): Promise<void> {
  const relative = sites.filter((s) => !isRootAbsolute(s.raw));
  if (relative.length === 0 || oldDir === newDir) return;
  let raw: string;
  try {
    raw = await store.readFile(selfPath);
  } catch {
    return;
  }
  let changed = false;
  for (const site of [...relative].sort((a, b) => b.start - a.start)) {
    if (site.start < 0 || site.end > raw.length) continue;
    const abs = posixResolve(oldDir, normalizeRef(site.raw));
    const next = relFrom(newDir, abs);
    raw = raw.slice(0, site.start) + next + raw.slice(site.end);
    changed = true;
  }
  if (changed) await store.writeFileAtomic(selfPath, raw);
}
