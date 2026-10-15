import { HTML_DESIGN_WIDTHS } from '@airp/shared/html-head';

/**
 * The one conversion from a virtual frontmatter `design` tier to a pixel
 * design width (1280 / 834 / 390). Shared by the card face and the live view,
 * so the two can never scale by different numbers.
 *
 * Missing or unrecognised value → `desktop`, matching the contract's default
 * (§4.4). The subpath import is load-bearing: the shared ROOT barrel pulls in
 * `node:crypto` and breaks the browser build (lib/airp-gateway.ts:8-10).
 */
export function designWidthOf(frontmatter: Record<string, any> | null): number {
  const design = frontmatter?.design;
  if (typeof design === 'string' && Object.prototype.hasOwnProperty.call(HTML_DESIGN_WIDTHS, design)) {
    return HTML_DESIGN_WIDTHS[design as keyof typeof HTML_DESIGN_WIDTHS];
  }
  return HTML_DESIGN_WIDTHS.desktop;
}
