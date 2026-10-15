// English copy: an `en` field in messages.json
// edits the English without changing the key, so call sites and the other
// languages stay as they are; the glossary's banned words stay out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const i18n = await jiti.import('../src/lib/i18n.ts');
const messages = JSON.parse(await readFile(new URL('../src/lib/messages.json', import.meta.url), 'utf8'));

test('an `en` field is the English copy; other languages keep their translation of the same key', () => {
  const [key, entry] = Object.entries(messages).find(([, e]) => typeof e.en === 'string');
  assert.equal(i18n.translate('en', key), entry.en.replace(/\{(\w+)\}/g, (t) => t));
  assert.equal(i18n.translate('ja', key), entry.ja);
  assert.equal(i18n.translate('en', 'Visit their ikigai'), 'Visit their nook');
  assert.equal(i18n.translate('en', 'Created "{name}". The object is now in {layer}. Next step: open it to view its contents.', { name: 'Lamp', layer: 'Car 2' }), 'Created “Lamp” in Car 2. Open it to see what’s inside.');
  // English copy never names the nook 「ikigai」 or uses British spelling.
  for (const [k, e] of Object.entries(messages)) {
    const english = e.en ?? k;
    assert.doesNotMatch(english, /ikigai|harbour|colour|traveller|practise/i, `English copy of ${JSON.stringify(k)}`);
  }
});

test('English counts of one are singular ("1 save", not "1 saves"); other languages untouched', () => {
  assert.equal(i18n.translate('en', '{count} saves', { count: 1 }), '1 save');
  assert.equal(i18n.translate('en', '{count} saves', { count: 2 }), '2 saves');
  assert.equal(i18n.translate('en', '{items} ITEMS · {people} PEOPLE', { items: 1, people: 1 }), '1 ITEM · 1 PERSON');
  assert.equal(i18n.translate('en', '{count} turns', { count: 0 }), '0 turns');
  assert.equal(i18n.translate('ja', '{count} saves', { count: 1 }), messages['{count} saves'].ja.replace('{count}', '1'));
});
