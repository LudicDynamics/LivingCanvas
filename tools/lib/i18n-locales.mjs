/**
 * Which translations messages.json must carry (`pnpm check:i18n`, tools/translate-messages.mjs).
 *
 * Every used key needs `zh-CN`, `ja` and `ko`. Korean (2026-10-03) was
 * PROVISIONAL — a missing `ko` only warned — until the overnight run
 * (tools/korean-overnight.sh) filled it; it is required since.
 *
 * The mechanism stays for the next language: put its code in
 * PROVISIONAL_LOCALES while the UI ships before the strings, and
 * `--require=<code>` (or AIRP_I18N_REQUIRE) makes it strict for one run.
 */
export const I18N_LOCALES = ['zh-CN', 'ja', 'ko'];
export const PROVISIONAL_LOCALES = new Set([]);

/** Locales that must be present for this run: every locale minus the provisional ones not explicitly required. */
export function requiredLocales({ argv = process.argv, env = process.env } = {}) {
  const asked = new Set([
    ...argv.filter((a) => a.startsWith('--require=')).flatMap((a) => a.slice('--require='.length).split(',')),
    ...String(env.AIRP_I18N_REQUIRE ?? '').split(','),
  ].map((s) => s.trim()).filter(Boolean));
  return I18N_LOCALES.filter((l) => !PROVISIONAL_LOCALES.has(l) || asked.has(l));
}

const fields = (value) => [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/**
 * Problems with one messages.json entry: a required locale missing, or ANY
 * present translation whose `{placeholders}` differ from the key's. Pure.
 */
export function entryProblems(key, entry, required) {
  const problems = [];
  for (const loc of I18N_LOCALES) {
    const value = entry?.[loc];
    if (typeof value !== 'string' || value === '') {
      if (required.includes(loc)) problems.push({ locale: loc, kind: 'missing' });
      continue;
    }
    if (JSON.stringify(fields(value)) !== JSON.stringify(fields(key))) problems.push({ locale: loc, kind: 'placeholders' });
  }
  // `en`: optional English copy edited after the key was set; same {placeholders} as the key.
  if (entry && 'en' in entry) {
    const value = entry.en;
    if (typeof value !== 'string' || value === '' || value === key) problems.push({ locale: 'en', kind: 'en-override' });
    else if (JSON.stringify(fields(value)) !== JSON.stringify(fields(key))) problems.push({ locale: 'en', kind: 'placeholders' });
  }
  return problems;
}
