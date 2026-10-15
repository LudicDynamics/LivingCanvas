/**
 * Small pure helpers for the local ↔ remote screens.
 */
import { translate } from './translate.js';
import { currentLocale } from './i18n.js';

/**
 * Refusals the player should read in their own language (the server's sentence is English): storage quotas by plan
 * and the daily publish limit. Keys are messages.json entries.
 */
export const REMOTE_CODE_TEXT: Readonly<Record<string, string>> = {
  quota_bytes_exceeded: 'Your cloud space for this plan is full, so this was not uploaded. Everything stays on this device and keeps working. Remove an older cloud draft, or upgrade your plan for more space.',
  quota_count_exceeded: 'You already keep as many cloud saves as your plan allows, so this was not uploaded. Everything stays on this device and keeps working. Remove an older cloud save, or upgrade your plan.',
  publish_rate_limited: 'You have reached today’s limit for publishing new worlds. This world stays a draft; try again later.',
};

/** A translated sentence for a known refusal code, else the server's own error sentence, else the caller's fallback. */
export function remoteErrorText(error: unknown, fallback: string): string {
  const code = remoteErrorCode(error);
  if (code && REMOTE_CODE_TEXT[code]) return translate(currentLocale(), REMOTE_CODE_TEXT[code]);
  const payload = (error as { payload?: { error?: unknown } } | null)?.payload;
  return typeof payload?.error === 'string' ? payload.error : fallback;
}

/** Near the plan's cloud limit (≥ 80 %) after an upload → one sentence to show, else null. */
export function quotaNoticeText(quota: { bytesPercent: number | null; countPercent: number | null; warnings: string[] } | null | undefined): string | null {
  if (!quota?.warnings?.length) return null;
  const locale = currentLocale();
  if (quota.warnings.includes('quota_bytes_near_limit') && quota.bytesPercent != null)
    return translate(locale, 'Your cloud space is {percent}% full. Uploads stop at 100% (play and edits on this device are not affected); upgrading your plan gives more space.', { percent: Math.min(100, quota.bytesPercent) });
  return translate(locale, 'You are close to your plan’s number of cloud saves. Uploads stop at the limit (play and edits on this device are not affected).');
}

/** The server's error code, if any (`not_connected`, `exists_local`, …). */
export function remoteErrorCode(error: unknown): string | null {
  const payload = (error as { payload?: { code?: unknown } } | null)?.payload;
  return typeof payload?.code === 'string' ? payload.code : null;
}

/** Bytes as a short size: `740 KB`, `12.3 MB`. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
