import messages from './messages.json';

/** The interface languages (lib/i18n.ts lists and picks them). */
export type Locale = 'en' | 'zh-CN' | 'ja' | 'ko';

/**
 * messages.json lookup, React-free (the live-call store imports it directly). English is the key itself,
 * unless the entry has an `en` field: the English copy edited after the key was set,
 * so call sites and the other languages keep the old key. A missing translation falls back to the English
 * (check:i18n keeps literal call sites complete).
 */
export function translate(locale: Locale, key: string, values: Record<string, string | number> = {}): string {
  const entry = (messages as Record<string, Record<string, string>>)[key];
  const english = entry?.en ?? key;
  const text = locale === 'en' ? singular(english, values) : entry?.[locale] ?? english;
  return text.replace(/\{(\w+)\}/g, (token, name) => String(values[name] ?? token));
}

/** English nouns that follow a `{count}`-style placeholder in messages.json, plural → singular. */
const SINGULAR: Readonly<Record<string, string>> = {
  saves: 'save', worlds: 'world', endings: 'ending', ratings: 'rating', likes: 'like', turns: 'turn', choices: 'choice',
  stars: 'star', items: 'item', people: 'person', credits: 'credit', days: 'day', activities: 'activity', notes: 'note',
  lines: 'line', marks: 'mark', files: 'file', models: 'model', rolls: 'roll', outcomes: 'outcome', places: 'place',
  secrets: 'secret', min: 'min', ITEMS: 'ITEM', PEOPLE: 'PERSON',
};
/** English only: "1 saves" → "1 save" (the keys are written in the plural; other languages carry their own forms). */
function singular(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\} (\w+)/g, (whole, name: string, word: string) => (values[name] === 1 && SINGULAR[word] ? `{${name}} ${SINGULAR[word]}` : whole));
}
