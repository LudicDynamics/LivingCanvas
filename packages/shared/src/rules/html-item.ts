/**
 * The single fetch point for "path + raw content → a renderable item"
 *.
 *
 * Before this existed, every read site called `parseFrontmatter` on its own and
 * each would have needed its own `.html` branch — five copies of the same
 * judgement, guaranteed to drift. Instead every site that turns file bytes into
 * an item calls this, and `.html` handling lives in exactly one place.
 *
 * The branch is driven by the EXTENSION, never by what `parseFrontmatter`
 * returns: a `---` block inside an HTML page is legal (an author may write one
 * in the body), and `parseFrontmatter` would happily parse it as frontmatter.
 * Deciding by the parse result would silently route such a page down the `.md`
 * path and leak its source as prose.
 *
 * Zero I/O on purpose: the caller already has the bytes (its store type
 * differs), so this stays a pure function that can be unit-tested directly.
 * Import direction is `rules/ → schemas/`, the safe way — the reverse edge
 * already exists (`frontmatter.ts` imports `rules/interactive.js`).
 */

import { parseFrontmatter } from '../schemas/frontmatter.js';
import { htmlVirtualFrontmatter, isHtmlPath, parseHtmlHead } from './html-head.js';

/** The two keys every consumer needs. Nothing else — see §5.3b. */
export interface DisplayItem {
  frontmatter: Record<string, unknown> | null;
  body: string;
}

/**
 * Turn one file's raw bytes into a renderable item. `.md` parses as always;
 * `.html` gets the virtual frontmatter (contract §5.1) and an EMPTY body, so
 * no renderer can ever mistake page source for prose.
 */
export function displayItemOf(path: string, raw: string): DisplayItem {
  if (!isHtmlPath(path)) {
    const { frontmatter, body } = parseFrontmatter(raw);
    return { frontmatter, body };
  }
  return { frontmatter: htmlVirtualFrontmatter(parseHtmlHead(raw), path), body: '' };
}
