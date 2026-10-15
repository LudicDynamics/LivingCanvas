/**
 * The head scanner for `.html` page cards.
 *
 * It answers exactly three questions about a self-contained `.html` file:
 * what title did the author want shown, what one-line description, and which
 * design width the page was laid out for. Everything else — the body, the CSS,
 * the scripts — is a question nobody asked, and the card renderer only ever
 * gets the three fields above.
 *
 * It is a pure scanner, not an HTML parser: no DOM, no dependency, no I/O, and
 * it never throws (the call site is the `/api/layer` assembly loop — a throw
 * there turns one odd file into a blank canvas for the whole layer; §7.1).
 *
 * Zero dependencies on purpose (same discipline as `rules/emotions.ts` and
 * `rules/tts-text.ts`): the server route, the `look_at` action, and the web
 * bundle all import this without pulling in zod, React, the world store, or
 * any Node builtin. That last point is why the web side may import this module
 * — and ONLY this module — by subpath (`@airp/shared/html-head`, §8.3); the
 * root barrel drags in `node:crypto` and would break the browser build.
 */

/** The frozen extraction result (contract §5.2). */
export interface HtmlHead {
  title: string | null;
  description: string | null;
  design: 'desktop' | 'tablet' | 'phone';
  /**
   * Contract §5.4: carries **anomalies only**. The sole member today is the
   * literal `'design-invalid'` (an `airp-design` tag whose value is not one of
   * the three widths). A missing tag / title / description is a legal
   * degradation and MUST NOT enter this array; an empty array means clean.
   */
  diagnostics: string[];
}

/** The three frozen design widths in CSS px (contract §4.4). The one source. */
export const HTML_DESIGN_WIDTHS: Record<'desktop' | 'tablet' | 'phone', number> = {
  desktop: 1280,
  tablet: 834,
  phone: 390,
};

const DESIGN_VALUES: Record<string, true> = { desktop: true, tablet: true, phone: true };

/**
 * Regex discipline (§4.2): every `/…/g` literal below is a module-level
 * singleton whose `exec`/`test` mutates `lastIndex`. Each use MUST reset it to
 * 0 first. Skipping this makes `metaTags()` resume mid-file on its second call
 * — a same-file description that appears and disappears, invisible to any test
 * that calls the parser once.
 */
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const RAWTEXT_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HEAD_CLOSED_RE = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i;
const HEAD_OPENED_RE = /<head\b[^>]*>/i;
const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i;
const META_RE = /<meta\b[^>]*>/gi;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

/**
 * A small but correct named-entity table (§7.5). Deliberately NOT the full
 * HTML table (2000+ entries that would rot); unrecognised names stay verbatim,
 * because leaving text alone beats changing the author's words.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', times: '\u00d7',
};

/**
 * Decode the entities worth decoding, leave everything else exactly as found.
 * Numeric forms (`&#39;` / `&#x41;`) are the common case and fully supported;
 * out-of-range and surrogate code points are passed through rather than thrown
 * on, since `String.fromCodePoint` would otherwise break the never-throws
 * promise (§7.1).
 */
function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (
        !Number.isFinite(code) ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      ) {
        return whole;
      }
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/** Trim, collapse internal whitespace, decode entities, then trim again. */
function normalizeText(raw: string): string {
  const collapsed = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return decodeEntities(collapsed).trim();
}

/** Every `<meta>` in `scope`, with lowercased attribute names (§3.6.1). */
function metaTags(scope: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  META_RE.lastIndex = 0;
  let tag: RegExpExecArray | null;
  while ((tag = META_RE.exec(scope)) !== null) {
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    let attr: RegExpExecArray | null;
    while ((attr = ATTR_RE.exec(tag[0])) !== null) {
      const [, name, dq, sq, bare] = attr;
      attrs[name.toLowerCase()] = dq ?? sq ?? bare ?? '';
    }
    out.push(attrs);
  }
  return out;
}

/**
 * Scan the head. Pure: no I/O, no state, no leaked regex `lastIndex`.
 *
 * The step order is load-bearing (§3); each step says what breaks without it.
 */
export function parseHtmlHead(raw: string): HtmlHead {
  // 1. Normalize: `undefined` from a caller's catch branch must degrade to ''
  //    rather than throw a TypeError inside the assembly loop.
  let doc = String(raw ?? '');

  // 2. Strip comments first: an author may comment out a whole old `<head>`,
  //    and a commented `<title>` would otherwise be read as the real one —
  //    silently, with no error, showing a title the author already deleted.
  doc = doc.replace(COMMENT_RE, '');

  // 3. Strip rawtext elements: `<style>`/`<script>` may legally contain `<`
  //    (CSS content strings, commented-out tags, JS string literals). Reading
  //    a title out of those is the second silent-wrong-text failure.
  doc = doc.replace(RAWTEXT_RE, '');

  // 4. Scope: a closed `<head>` wins; then "everything after an unclosed
  //    `<head>`" (an author who forgot the closer still gets their title);
  //    then the whole document (plenty of real pages are fragments with no
  //    `<head>` at all). Returning nulls in that third case would permanently
  //    show a filename for a page that really does declare a title.
  const closed = HEAD_CLOSED_RE.exec(doc);
  const opened = HEAD_OPENED_RE.exec(doc);
  const scope = closed
    ? closed[1]
    : opened
      ? doc.slice(opened.index + opened[0].length)
      : doc;

  // 5. Title: first match wins (HTML semantics — later ones are ignored).
  const titleTag = TITLE_RE.exec(scope);
  const title = titleTag ? normalizeText(titleTag[1]) || null : null;

  // 6. Description: exhaust `name="description"` before falling back to
  //    `property="og:description"`. A single combined `find` would pick `og:`
  //    whenever it appears first in the document — the priority is two levels,
  //    not "whichever shows up".
  const metas = metaTags(scope);
  const named = metas.find((a) => (a.name ?? '').toLowerCase() === 'description');
  const og = metas.find((a) => (a.property ?? '').toLowerCase() === 'og:description');
  const descriptionTag = named ?? og;
  const description = descriptionTag ? normalizeText(descriptionTag.content ?? '') || null : null;

  // 7. Design: normalize before lookup so " Desktop " is typography noise, but
  //    a value outside the three widths is an author error — fall back to
  //    desktop AND say so. A missing tag says nothing (the default is the
  //    normal path). MUST always be one of the three: the front end divides by
  //    `HTML_DESIGN_WIDTHS[design]`, so `undefined` would render NaN.
  let design: HtmlHead['design'] = 'desktop';
  const diagnostics: string[] = [];
  const designTag = metas.find((a) => (a.name ?? '').toLowerCase() === 'airp-design');
  if (designTag) {
    const value = normalizeText(designTag.content ?? '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(DESIGN_VALUES, value)) {
      design = value as HtmlHead['design'];
    } else {
      diagnostics.push('design-invalid');
    }
  }

  // 8. No truncation: this is a source of truth, not a second-hand summary.
  //    The render-time cap (`layer-page.ts` SUMMARY_CAP) applies downstream.
  return { title, description, design, diagnostics };
}

/**
 * `.html` with a `world/.html`-style path: `.html` rather than an empty title,
 * since a blank card is worse than an odd but readable one.
 */
function basenameWithoutExt(path: string): string {
  const base = String(path ?? '').split('/').pop() ?? '';
  return base.replace(/\.html$/i, '') || base;
}

/**
 * The virtual frontmatter (contract §5.1). It lives only in the response
 * memory — MUST NOT be written to disk, and the `body` beside it is always ''
 * so no renderer can mistake page source for prose.
 *
 * Exactly four keys. A fifth would invent semantics the contract did not, and
 * every downstream consumer (`entityName` / `summaryOf` / `CardRenderer`)
 * would start depending on it.
 */
export function htmlVirtualFrontmatter(head: HtmlHead, path: string): Record<string, unknown> {
  return {
    type: 'html',
    title: head.title ?? basenameWithoutExt(path),
    preview: head.description ?? '',
    design: head.design,
  };
}

/**
 * Case-insensitive `.html` test (contract §4.2). MUST be the only extension
 * check in the repository — every consumer imports this rather than writing
 * its own `/\.html$/i`, so `X.HTML` can never be classified two ways.
 */
export function isHtmlPath(path: string): boolean {
  return /\.html$/i.test(String(path ?? ''));
}
