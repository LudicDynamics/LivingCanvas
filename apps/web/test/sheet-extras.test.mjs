// The inspiration roll, companion specialties and teach-once cues on the page
//. No HUD: both live inside the
// player's character sheet; the canvas gains nothing. Pure helpers + mounts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { normalizeSheets, inspirationOf, lendersOf, EMPTY_SHEETS } = await jiti.import('../src/lib/sheets.ts');

const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const panels = await src('../src/components/chrome/StatePanels.tsx');
const extras = await src('../src/components/chrome/SheetExtras.tsx');
const sheet = await src('../src/components/chrome/CharacterSheet.tsx');
const gateway = await src('../src/lib/airp-gateway.ts');
const app = await src('../src/App.tsx');

test('inspirationOf: ready / waiting / off, fail-soft', () => {
  assert.equal(inspirationOf(null), null);
  assert.equal(inspirationOf({ enabled: false, label: 'x', system: 'coc', value: 50, gate: { ok: true, left: 5 } }), null);
  assert.deepEqual(inspirationOf({ enabled: true, label: '灵感', system: 'coc', value: 50, gate: { ok: true, left: 5 } }), { label: '灵感', system: 'coc', value: 50, ready: true, left: 5 });
  assert.deepEqual(
    inspirationOf({ enabled: true, label: '灵感', system: 'coc', value: 50, gate: { ok: false, reason: 'cooldown', wait: 1, unit: 'clock', left: 3 } }),
    { label: '灵感', system: 'coc', value: 50, ready: false, left: 3, wait: { n: 1, unit: 'clock' } },
  );
});

test('normalizeSheets keeps assist, names, who is along; lendersOf lists what they lend', () => {
  const out = normalizeSheets({
    rules: { system: 'coc', label: '类 CoC' },
    player: { skills: [{ id: 'listen', label: '聆听', value: 40, desc: '听见声音' }] },
    characters: {
      kuri: { name: '阿栗', skills: [{ id: 'listen', label: '聆听', value: 70, assist: true }, { id: 'stealth', label: '潜行', value: 50 }] },
      chizuru: { name: '千鹤', skills: [{ id: 'occult', label: '神秘学', value: 60 }] },
    },
    with: ['kuri', 'ghost'],
    inspiration: { enabled: true, label: '灵感', system: 'coc', value: 50, gate: { ok: true, left: 5 } },
  });
  assert.deepEqual(out.with, ['kuri'], 'only characters with a sheet');
  assert.equal(out.characters.kuri.name, '阿栗');
  assert.equal(out.player.skills[0].desc, '听见声音');
  const lenders = lendersOf(out);
  assert.equal(lenders.length, 1);
  assert.deepEqual(lenders[0].lends.map((s) => s.id), ['listen']);
  assert.equal(out.inspiration.ready, true);
  assert.deepEqual(EMPTY_SHEETS.with, []);
  assert.equal(EMPTY_SHEETS.inspiration, null);
});

test('no HUD: the roll and the companions mount only inside the opened sheet', () => {
  assert.match(panels, /<CompanionSkills sheets=\{sheets\} \/>/);
  assert.match(panels, /<InspirationRoll inspiration=\{sheets\.inspiration\}/);
  assert.ok(panels.indexOf('<InspirationRoll') > panels.indexOf('sheetOpen && sheets?.rules'), 'after the sheet opens');
  // Nothing on the canvas: in App they only mount inside the 「技能」 panel the avatar's button opens.
  const panel = app.slice(app.indexOf('<AvatarSheetPanel'), app.indexOf('</AvatarSheetPanel>'));
  const outside = app.replace(panel, '').replace(/^import .*$/gm, '');
  assert.doesNotMatch(outside, /<InspirationRoll|<CompanionSkills/, 'nothing on the canvas');
  assert.match(panel, /<InspirationRoll inspiration=\{worldSheets\.inspiration\}/);
  assert.match(extras, /fetch\('\/api\/inspiration'/);
  assert.match(extras, /noteCue\(d\.cue, locale\)/);
  assert.match(sheet, /character-sheet__desc/, 'what each skill is for, visible');
  assert.match(sheet, /data-testid="sheet-assist"/);
});

test('teach-once cues are tapped from the routes that carry them', () => {
  assert.match(gateway, /'\/api\/enter-layer'[^\n]*\.then\(tapCue\)/);
  assert.match(gateway, /'\/api\/following'[^\n]*\.then\(tapCue\)/);
  assert.match(gateway, /'\/api\/choice'[^\n]*\.then\(tapCue\)/);
  assert.match(sheet, /noteCue\(d\.cue, locale\)/);
});
