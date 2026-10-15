/**
 * One honest status line for Nook identity surfaces.
 *
 * Two consumers need different fallbacks:
 * - the topbar existence core shows a label even when the character has no
 *   status yet, so it falls back to the README title;
 * - the portrait nameplate already prints the display name, so echoing the
 *   README title would state the same identity twice. It shows the real
 *   `status.data` or nothing.
 *
 * Nothing here invents copy: a missing status stays missing.
 */

type Frontmatter = Record<string, any> | null | undefined;

const trimmed = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** The genuine status, ignoring any title fallback. */
export function portraitStatusOf(frontmatter: Frontmatter): string | null {
  const data = frontmatter?.status?.data;
  const direct = trimmed(data);
  if (direct) return direct;
  if (data && typeof data === 'object') {
    const parts = Object.entries(data as Record<string, unknown>)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${key}: ${String(value)}`);
    if (parts.length > 0) return parts.join(' · ');
  }
  return null;
}

/** Topbar status: the genuine status, else the README title, else nothing. */
export function statusLineOf(frontmatter: Frontmatter): string | null {
  return portraitStatusOf(frontmatter) ?? trimmed(frontmatter?.title);
}
