import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const canvas = await readFile(new URL('../src/components/canvas/CanvasObject.tsx', import.meta.url), 'utf8');
const card = await readFile(new URL('../src/components/canvas/CardRenderer.tsx', import.meta.url), 'utf8');
const prop = await readFile(new URL('../src/components/canvas/PropCard.tsx', import.meta.url), 'utf8');
const photo = await readFile(new URL('../src/components/canvas/PhotoCard.tsx', import.meta.url), 'utf8');
const entity = await readFile(new URL('../src/components/narrative/EntityInteractions.tsx', import.meta.url), 'utf8');

test('CanvasObject is the single owner of card reading', () => {
  assert.match(canvas, /import \{ BagItemDialog \} from '\.\.\/BagItemDialog\.js'/);
  assert.match(canvas, /setReading\(value => !value\)/);
  assert.match(canvas, /onClose=\{\(\) => setReading\(false\)\}/);
  assert.doesNotMatch(card, /BagItemDialog|letterOpen/);
  assert.doesNotMatch(entity, /BagItemDialog|Look closer|readingProjection/);
});

test('Take along remains the only authoritative card action region', () => {
  // `runAction` is the shared hook's coordinator call; Take
  // along still goes through it rather than touching the gateway directly.
  // The big 「收入随身」 button runs the same `take`.
  assert.match(entity, /const take = \(\) => void runAction\(\s*'take'/);
  assert.match(entity, /id !== 'take' \|\| collectable/);
  assert.match(entity, /t\('Added to belongings\.'\)/);
  assert.doesNotMatch(card, /onTakeItem|note__take|take_label/);
  assert.doesNotMatch(photo, /onTakeItem|photo-card__take|take_label/);
});

test('Reading does not send a writer request and has an equivalent keyboard path', () => {
  assert.match(canvas, /if \(event\.key === 'Enter'\)/);
  assert.match(canvas, /setReading\(value => !value\)/);
  assert.doesNotMatch(entity, /Look closer/);
  assert.doesNotMatch(entity, /requestCanvasReading|dispatchEvent\(new KeyboardEvent/);
});

test('Gate and door keep inspect on click with desktop double-click and focused Enter enter paths', () => {
  assert.match(canvas, /if \(isGate \|\| isDoor\) \{\s*setInspected\(true\)/);
  assert.match(canvas, /onDoubleClick=\{event => \{[\s\S]*requestEnter\(gateTarget\)/);
  assert.match(canvas, /if \(isGate \|\| isDoor\) \{\s*requestEnter\(gateTarget\)/);
  assert.match(entity, /canEnter: !!onEnterGate/);
  assert.match(prop, /DOUBLE-CLICK TO ENTER/);
  assert.doesNotMatch(prop, /clickTimer|onDoubleClick|onKeyDown/);
});
