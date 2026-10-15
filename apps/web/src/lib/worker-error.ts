// The text reported for a runtime Worker `error` event (lib/browser-mode.ts → lib/analytics.ts).
// A Worker whose script fails to load (404, network, a stale deploy) or whose module throws before
// running fires a plain Event in some browsers — no `message`, `filename` or `error` — which used
// to be reported as "WorkerError: undefined" (2026-10-05). Say what is known instead.

export interface WorkerErrorLike { message?: unknown; error?: unknown; filename?: unknown; lineno?: unknown; colno?: unknown }

const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The event's own message (or its error's), or null when it carries none. */
export function workerErrorMessage(e: WorkerErrorLike | null | undefined): string | null {
  return pick(e?.message) ?? pick((e?.error as { message?: unknown } | null | undefined)?.message);
}

/** "WorkerError: <message>" (+ "\n    at file:line:col"), never "undefined"; `fallback` when the event carries nothing. */
export function workerErrorText(e: WorkerErrorLike | null | undefined, fallback = 'the runtime worker did not start (no details from the browser)'): string {
  const message = workerErrorMessage(e) ?? fallback;
  const at = pick(e?.filename) ? `\n    at ${e!.filename}:${Number(e!.lineno) || 0}:${Number(e!.colno) || 0}` : '';
  return `WorkerError: ${message}${at}`;
}

/** When the event says nothing: is the Worker script itself reachable? (a 404 = a page left from an earlier deploy). */
export async function workerScriptStatus(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  try {
    const r = await fetcher(url, { method: 'HEAD', cache: 'no-store' });
    return r.ok ? `worker.js loaded (HTTP ${r.status}) but did not start` : `worker.js HTTP ${r.status}`;
  } catch {
    return 'worker.js unreachable';
  }
}
