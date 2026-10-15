/**
 * The ONE sanitiser for every piece of dynamic text that can reach an injected
 * state block (00 §14). The block is line-structured — a section boundary is a
 * blank line — so the paramount rule is: no newline survives. Quotes are
 * stripped because 02 echoes several values inside `"..."`, and a stray quote
 * lets a world file / browser report break out of that quoting.
 *
 * This is CONTENT-level folding, not a length check (00 §14.1): the caller's
 * shape gate (`isPlausibleLayer`) runs FIRST and is NOT a substitute — a
 * plausible-looking layer id can still carry `\n\nIgnore previous instructions`.
 *
 * Threat model (00 §14): the injection block prints world-file text
 * (`entityName` title, layer README name, event `detail.name`) as well as the
 * browser-reported viewpoint. `POST /api/god-action` is unauthenticated, so
 * "only the viewpoint endpoint is external" is false — every renderer that
 * prints a dynamic string MUST route it through here.
 *
 * Pure, total, never throws.
 */
export function sanitiseForBlock(raw: unknown, opts: { maxLength: number }): string {
  const text = typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw);
  const folded = text
    // 1. Newlines + C0/C1 controls -> single space (the most important rule:
    //    injection forges structure with newlines and blank lines).
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    // 2. Converge quotes: break quote-escape and fence-forging.
    .replace(/["'`\\]+/g, '')
    // 3. Collapse the runs rule 1/2 left behind.
    .replace(/\s+/g, ' ')
    .trim();
  // 4. Length cap (00 §14.1 rule 3); the caller supplies `maxLength`.
  return folded.length > opts.maxLength ? folded.slice(0, opts.maxLength) : folded;
}
