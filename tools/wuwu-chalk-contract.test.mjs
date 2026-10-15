// Static authoring-contract checks, not a simulation of Writer compliance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { experiences } from './experiences/index.mjs';

const pack = experiences.find(p => p.base === 'wuwu');
const skill = pack.files['skills/wuwu-playtest-play/SKILL.md'];
const section = (start, end) => skill.slice(skill.indexOf(start), end ? skill.indexOf(end) : undefined);

test('Wuwu keeps consent, multiline dice and a continuation in the prepared Chalk', () => {
  assert.match(skill, /roll_dice を複数行 YAML/);
  assert.match(skill, /expect は ">=11"/);
  assert.match(skill, /choice を「出目を受けて行動する」「調査へ戻る」に更新/);
  assert.match(skill, /まだ result がない時[\s\S]*代わりに振らず、消費も生成もしない/);
  assert.match(skill, /intent にこの節への参照と判定元 world\/harbor-chart\/03-lighting-terms.md/);
});

test('failure has real bounded loss, no oil cost for 5–10, and concrete recovery choices', () => {
  const failure = section('3. 2–4', '5. 11–17');
  assert.match(failure, /player\/lamp-oil.md[\s\S]*空瓶/);
  assert.match(failure, /5–10 なら油を減らさず/);
  assert.match(failure, /「潮の跡と日誌を照合する」「ヴェラに方法を相談する」/);
  assert.match(failure, /灯油も再判定も不要/);
  assert.match(failure, /world\/harbor-chart\/tidal-approach\//);
  assert.match(failure, /失敗を無料の成功へ置換せず/);
});

test('success preview cannot generate a full reveal or issue the great-success reward', () => {
  const preview = section('5. 11–17', '6. 成功した');
  assert.match(preview, /revealState: pending/);
  assert.match(preview, /choice「光の先を確かめる」「調査へ戻る」/);
  assert.match(preview, /完全な発見、子フォルダ、背景生成、紹介状の発行をしない/);
  assert.match(preview, /自動でカメラや場面を切り替えない/);
});

test('only a success continuation click reveals the scene; great rewards remain distinct', () => {
  const reveal = section('6. 成功した', '## 霧の先へ');
  assert.match(reveal, /成功後に押された準備済みの「出目を受けて行動する」だけ/);
  assert.match(reveal, /world\/harbor-chart\/beyond-the-fog\/README.md/);
  assert.match(reveal, /18–20 の時だけ player\/introduction-letter\.md/);
  assert.match(reveal, /11–17 にこの追加報酬を渡さない/);
  assert.match(reveal, /存在確認後に revealState: revealed/);
  assert.match(reveal, /再クリックは同じ入口[\s\S]*不足だけ修復/);
  assert.match(reveal, /自動入場せず/);
});

test('no pre-earned roll, reward or generated scene is shipped in the template', () => {
  assert.ok(!Object.keys(pack.files).some(p => /tidal-approach|beyond-the-fog|introduction-letter|03-lighting-terms/.test(p)));
  assert.ok(Object.keys(pack.files).every(p => /^[a-zA-Z0-9/_.-]+$/.test(p)));
  for (const match of skill.matchAll(/(?:world|player)\/[\w/.-]+/g)) assert.match(match[0], /^[a-zA-Z0-9/_.-]+$/);
  assert.doesNotMatch(skill, /(?:world|player)\/[^\s、。）（「」]*[\p{Script=Hiragana}\p{Script=Katakana}]/u);
  assert.match(skill, /既存 result を消して無料で振り直さない/);
  assert.match(skill, /空瓶なら二度目の油を引かない/);
});
