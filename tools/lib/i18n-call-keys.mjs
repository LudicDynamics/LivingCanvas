import ts from 'typescript';

/** Only the key argument belongs to i18n; interpolation values may contain
 * arbitrary strings (such as text.split('\n')). Parse TS/TSX to separate them. */
export function translationCalls(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  function keys(node) {
    if (!node) return [];
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return keys(node.expression);
    if (ts.isConditionalExpression(node)) return [...keys(node.whenTrue), ...keys(node.whenFalse)];
    return [];
  }
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      for (const key of keys(node.arguments[0])) found.push({ key, line });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

/** The `en` half of `UI_COPY`, parsed from legacy-ui-copy.ts source text.
 * Values are what `translate(locale, value)` later looks up as message keys. */
export function englishCopyValues(text) {
  const start = text.indexOf('en: {');
  const end = text.indexOf('ja: {');
  const block = text.slice(start, end < 0 ? undefined : end);
  const values = new Map();
  for (const match of block.matchAll(/^\s*(\w+):\s*'((?:[^'\\]|\\.)*)'/gm)) values.set(match[1], match[2]);
  return values;
}

/** Every `<objectName>.<key>` read in `text` whose key IS a `UI_COPY` key.
 * These are the reads that feed a VALUE into a message-key lookup
 * (`translate(locale, UI_COPY.en[x])`, the `copy` map in NookView); a literal
 * `t()` scan cannot follow them.
 *
 * Reads whose key is absent from `copyValues` are skipped: they cannot be
 * UI_COPY reads (e.g. a fragment of an import specifier). */
export function copiedKeyReads(text, objectName, copyValues) {
  const re = new RegExp(`\\b${objectName}\\.([A-Za-z_]\\w*)`, 'g');
  const out = [];
  for (const match of text.matchAll(re)) {
    if (!copyValues.has(match[1])) continue;
    out.push({ key: match[1], value: copyValues.get(match[1]) });
  }
  return out;
}

/** The subset of `copiedKeyReads` whose English value is NOT itself a
 * messages.json entry — `translate()` then falls back to the English sentence
 * in every locale, silently. */
export function blindCopyKeyReads(text, objectName, copyValues, messages) {
  const seen = new Set();
  const out = [];
  for (const read of copiedKeyReads(text, objectName, copyValues)) {
    if (messages[read.value] || seen.has(read.key)) continue;
    seen.add(read.key);
    out.push(read);
  }
  return out;
}

/** Compare the blind keys found today against the shrink-only baseline.
 * Returns the two failure directions as strings: a key that is blind but
 * unregistered (`NEW`), and a baseline entry that is no longer blind
 * (`stale`, i.e. it was fixed and the list must shrink). */
export function compareBlindKeys(found, baseline) {
  const keys = [...found].map((read) => read.key);
  const problems = [];
  for (const read of found) {
    if (baseline.has(read.key)) continue;
    const where = read.file ? `${read.file} :: ` : '';
    problems.push(`NEW blind key: ${where}copy.${read.key} -> "${read.value}"`);
  }
  const stale = [...baseline].filter((key) => !keys.includes(key));
  if (stale.length) problems.push(`baseline entry no longer blind (shrink it): ${stale.join(', ')}`);
  return problems;
}
