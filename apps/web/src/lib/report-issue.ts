/**
 *. the design notes
 *
 * The player picks 卡住了 / 出 bug 了 / 建议, writes a line if they like, and sees what goes with it BEFORE sending:
 * the world (and edition), the place (layer) they are in, the app version and a few error codes — never the
 * conversation. It goes through this app's server (`POST /api/account-data/feedback`, apps/server/src/routes/
 * account-data.ts) to the data service's `livingcanvas/bug-report` (the Worldlines platform manifest v12): as the account
 * when signed in, else as this device's guest-trial session; neither → `signed_out` and the sheet points at the
 * contact channels. The console's 「玩家反馈」 page counts distinct players per (world, place).
 *
 * Pure helpers + one window event (two entries open the same sheet: the world header and the 联系我们 panel).
 */

export const REPORT_KINDS = ['stuck', 'bug', 'idea'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_TEXT_MAX = 1000;
export const REPORT_OPEN_EVENT = 'airp:report-issue';
export const REPORT_PATH = '/api/account-data/feedback';

/** What the sheet shows and sends about where the player is. Nothing here is story text. */
export interface ReportContext {
  /** The id ratings / favorites use (official editions folded: lib/account-data.ts worldKeyOf); null = the lobby. */
  worldId: string | null;
  /** The exact world / edition id (e.g. last-train-jp); null when it is the same as worldId or there is no world. */
  edition: string | null;
  /** Display name of the world, shown only (not sent: the console knows its worlds by id). */
  worldName: string | null;
  /** The layer path the player is in (`world/platform`); null in the lobby. */
  place: string | null;
  /** The place's display title (shown, and sent so the console reads 「月台」 instead of a path). */
  placeTitle: string | null;
  version: string;
  mode: 'local' | 'browser';
  locale: 'en' | 'zh-CN' | 'ja' | 'ko';
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// eslint-disable-next-line no-control-regex
const PLACE = /^[^\u0000-\u001F\u007F]{1,200}$/;
const FP = /^[a-f0-9]{32}$/;

/** The request body: exactly the fields the player saw in the sheet (+ error codes), nothing else. */
export function reportBody(kind: ReportKind, text: string, ctx: ReportContext, errors: readonly string[] = []): Record<string, unknown> {
  const body: Record<string, unknown> = { kind };
  const words = [...text.trim()].slice(0, REPORT_TEXT_MAX).join('');
  if (words) body.text = words;
  if (ctx.worldId && ID.test(ctx.worldId)) body.world_id = ctx.worldId;
  if (ctx.edition && ID.test(ctx.edition) && ctx.edition !== ctx.worldId) body.edition = ctx.edition;
  if (ctx.place && PLACE.test(ctx.place)) body.place = ctx.place;
  const title = (ctx.placeTitle ?? '').trim();
  if (title && body.place) body.place_title = [...title].slice(0, 120).join('');
  if (/^[A-Za-z0-9._+-]{1,40}$/.test(ctx.version)) body.client_version = ctx.version;
  body.client_mode = ctx.mode;
  body.locale = ctx.locale;
  const fps = [...new Set(errors.filter((e) => FP.test(e)))].slice(0, 5);
  if (fps.length) body.errors = fps;
  return body;
}

export type ReportResult =
  | { status: 'sent'; as: 'account' | 'guest' }
  | { status: 'signed_out' }
  | { status: 'unavailable' }
  | { status: 'refused'; code: string };

/** POST the report through this app's server. Never throws. */
export async function sendReport(body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<ReportResult> {
  try {
    const res = await fetchImpl(REPORT_PATH, { method: 'POST', headers: { 'content-type': 'application/json', 'x-airp-settings': '1' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; available?: boolean; reason?: string; code?: string; as?: string } | null;
    if (json?.ok && res.ok) return { status: 'sent', as: json.as === 'guest' ? 'guest' : 'account' };
    if (json?.available === false) return json.reason === 'signed_out' || json.reason === 'not_allowed' ? { status: 'signed_out' } : { status: 'unavailable' };
    if (res.status === 429) return { status: 'refused', code: 'rate_limited' };
    return { status: 'refused', code: typeof json?.code === 'string' ? json.code : `http_${res.status}` };
  } catch {
    return { status: 'unavailable' };
  }
}

/** Open the sheet (from the world header button or the 联系我们 panel). */
export function openReportIssue(kind: ReportKind | null = null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(REPORT_OPEN_EVENT, { detail: { kind } }));
}
