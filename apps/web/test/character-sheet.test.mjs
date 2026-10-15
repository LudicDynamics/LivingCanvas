// Character sheets.
//
// No HUD: the sheet opens only from the player's avatar panel ("Character
// sheet") or folded inside a character's modal; a check card says the skill
// instead of a raw "Requires: <=60". These pin the pure helpers and the mounts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { EMPTY_SHEETS, normalizeSheets, skillCardLine, skillScore, skillTierText } = await jiti.import('../src/lib/sheets.ts');

const src = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const app = await src('../src/App.tsx');
const panels = await src('../src/components/chrome/StatePanels.tsx');
const sheet = await src('../src/components/chrome/CharacterSheet.tsx');
const modal = await src('../src/components/overlay/CharacterModal.tsx');
const roller = await src('../src/components/narrative/DiceRoller.tsx');
const ceremony = await src('../src/components/performance/DiceCeremony.tsx');
const css = await src('../src/components/chrome/state-panels.css');
const workshop = await src('../src/components/chrome/WorkshopArtPanel.tsx');

test('normalizeSheets is fail-soft: no rules → no sheets', () => {
  assert.deepEqual(normalizeSheets(null), EMPTY_SHEETS);
  assert.deepEqual(normalizeSheets({ rules: { system: 'gurps' }, player: { skills: [{ id: 'x', label: 'X', value: 5 }] } }), EMPTY_SHEETS);
});

test('normalizeSheets keeps well-formed skills and characters with sheets only', () => {
  const out = normalizeSheets({
    rules: { system: 'coc', label: '类 CoC', sanity: true },
    player: { skills: [{ id: 'spot_hidden', label: '侦查', value: 60, half: 30, fifth: 12, marked: true }, { id: 'bad' }] },
    characters: { watson: { skills: [{ id: 'medicine', label: '医学', value: 70, half: 35, fifth: 14 }] }, nobody: { skills: [] } },
  });
  assert.equal(out.rules.system, 'coc');
  assert.equal(out.rules.sanity, true);
  assert.deepEqual(out.player.skills.map((s) => s.id), ['spot_hidden']);
  assert.equal(out.player.skills[0].marked, true);
  assert.deepEqual(Object.keys(out.characters), ['watson']);
  assert.equal(skillScore('coc', out.player.skills[0]), '60%');
  assert.equal(skillScore('dnd', { id: 'arcana', label: 'Arcana', modifier: 5 }), '+5');
  assert.equal(skillScore('dnd', { id: 'stealth', label: 'Stealth', modifier: -1 }), '-1');
});

test('a check card speaks the skill, the tier speaks the page language', () => {
  assert.equal(skillCardLine({ system: 'coc', label: '侦查', value: 60, difficulty: 'regular' }, 'zh-CN'), '侦查 60%');
  assert.equal(skillCardLine({ system: 'coc', label: 'Spot Hidden', value: 60, difficulty: 'hard' }, 'en'), 'Spot Hidden 30% (Hard)');
  assert.equal(skillCardLine({ system: 'dnd', label: 'Arcana', value: 5, difficulty: '15' }, 'en'), 'Arcana +5 · DC 15');
  assert.equal(skillCardLine(null, 'en'), null);
  assert.equal(skillTierText({ system: 'coc', tier: 'hard' }, 'ja'), 'ハード成功');
  assert.equal(skillTierText({ system: 'dnd', tier: 'critical' }, 'zh-CN'), '天然 20');
  assert.equal(skillTierText(undefined, 'en'), null);
});

test('no HUD: the sheet opens from the player panel and folds inside the character modal', () => {
  assert.match(app, /useWorldSheets\(/);
  assert.match(app, /sheets=\{worldSheets\}/);
  assert.match(app, /sheet=\{worldSheets\.characters\[activeCharacter\.id\] \?\? null\}/);
  assert.match(panels, /data-testid="open-character-sheet"/);
  assert.match(panels, /sheetOpen && sheets\?\.rules/, 'the sheet renders only after the button');
  assert.match(modal, /<details className="identity-sheet"/, 'folded until asked');
  assert.doesNotMatch(modal, /<details className="identity-sheet"[^>]*\bopen\b/);
  assert.match(sheet, /fetch\('\/api\/skill-check'/);
  assert.match(sheet, /<DiceRoller filePath=\{pending\.path\}/, 'the player rolls the framed check right there');
  assert.match(roller, /skillLine \?\? t\('Requires: \{expect\}', \{ expect: rollDice\.expect \}\)/);
  assert.match(ceremony, /<SkillCaption skill=\{input\.skill\} \/>/);
  assert.match(css, /\.player-panel--sheet \{[^}]*overflow-y: auto/);
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.player-panel--sheet \{ left: 16px; right: 16px; width: auto;/, 'mobile: full width inside a 16px gutter');
});

test('switching CoC ↔ D&D in 设定 asks before the sheets are replaced; cancel keeps the old setup', () => {
  assert.match(workshop, /payload\?\.code === 'sheets_reset_required'/);
  assert.match(workshop, /role="alertdialog"[^>]*data-testid="sheets-reset-confirm"/);
  assert.match(workshop, /onClick=\{\(\) => \{ setResetAsk\(null\); setDraft\(stored\); \}\}>\{t\('Cancel'\)\}/);
  assert.match(workshop, /onClick=\{\(\) => void save\(true\)\}>\{t\('Replace the sheets'\)\}/);
});
