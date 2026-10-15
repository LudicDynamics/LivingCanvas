// Can this browser run the in-tab runtime (apps/browser-runtime)? Checked before the Worker starts, so an old
// browser gets "Your browser is too old" (in the interface language, lib/boot-copy.ts) instead of a dead Worker (chronicle 2026-10-06 / 10-07: Safari 16 died on a
// RegExp `v` flag inside server.js — fixed in the build, but the floor below is real).
//
// Floor (apps/browser-runtime/README.md「浏览器要求」): Safari / iOS 16.4, Chrome / Edge 98, Firefox 125.
//   - regex lookbehind: literals in the bundled server — below Safari 16.4 server.js does not even parse
//   - Intl.Segmenter at module level (pi-rp TUI width, the zh word segmenter): Firefox 125
//   - structuredClone / Array.prototype.at / Object.hasOwn: Safari 15.4, Chrome 98 / 92 / 93
//   - module Workers + WebAssembly (SQLite) + Service Workers: older than all of the above
// Feature tests only (no User-Agent sniffing, no eval: works under a strict CSP).

import { bootText } from './boot-copy.js';
import type { Locale } from './translate.js';

export const MIN_BROWSERS = 'Safari / iOS 16.4, Chrome 98, Firefox 125';
export const OUTDATED_MESSAGE = bootText('en', 'outdated');

type G = typeof globalThis & Record<string, unknown>;

/** The missing features (empty = supported). `g` is injectable for tests. */
export function missingRuntimeFeatures(g: G = globalThis as G): string[] {
  const missing: string[] = [];
  const RE = g.RegExp as RegExpConstructor | undefined;
  try { if (!RE || !new RE('(?<=a)b').test('ab')) missing.push('regex-lookbehind'); } catch { missing.push('regex-lookbehind'); }
  const intl = g.Intl as { Segmenter?: unknown } | undefined;
  if (typeof intl?.Segmenter !== 'function') missing.push('Intl.Segmenter');
  if (typeof g.structuredClone !== 'function') missing.push('structuredClone');
  const A = g.Array as ArrayConstructor | undefined;
  if (typeof A?.prototype?.at !== 'function') missing.push('Array.prototype.at');
  const O = g.Object as ObjectConstructor | undefined;
  if (typeof (O as { hasOwn?: unknown } | undefined)?.hasOwn !== 'function') missing.push('Object.hasOwn');
  if (typeof g.Worker !== 'function') missing.push('Worker');
  if (typeof g.WebAssembly !== 'object' || g.WebAssembly === null) missing.push('WebAssembly');
  return missing;
}

/** The error a boot fails with when the browser is too old (the boot screen shows OUTDATED_MESSAGE for it). */
export class OutdatedBrowserError extends Error {
  constructor(readonly missing: string[]) {
    super(`unsupported browser: missing ${missing.join(', ')}`);
    this.name = 'OutdatedBrowserError';
  }
}

/** An engine error that only an old browser produces (a newer build feature it cannot parse or construct). */
const OLD_ENGINE = /Invalid flags supplied to RegExp constructor|invalid regular expression flags|Invalid regular expression: invalid group specifier name|unsupported browser: missing/i;

export interface BootFailure { outdated: boolean; title: string; hint: string; detail: string }

/** What the boot screen says when the runtime did not start, in the boot screen's language. Never only the raw message; always a way forward. */
export function bootFailure(e: unknown, locale: Locale = 'en'): BootFailure {
  const detail = String((e as { message?: unknown } | null)?.message ?? e ?? '').split('\n')[0].slice(0, 300);
  const say = (line: Parameters<typeof bootText>[1]) => bootText(locale, line);
  if (e instanceof OutdatedBrowserError || OLD_ENGINE.test(detail)) {
    return { outdated: true, title: `${say('failed')} — ${say('outdated')}`, hint: say('outdatedHint').replace('{min}', MIN_BROWSERS), detail };
  }
  return { outdated: false, title: `${say('failed')} — ${say('notStarted')}`, hint: say('retryHint'), detail };
}
