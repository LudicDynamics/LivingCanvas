import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate, mappedPath, textRefs } from './migrate-japanese-paths.mjs';

test('migration keeps earned objects, dice, display text, DB geometry and backup', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'airp-path-test-'));
  const root = path.join(temp, 'wuwu-playtest');
  for (const d of ['player', 'world/港の地図', '.airpworld']) fs.mkdirSync(path.join(root,d),{recursive:true});
  fs.writeFileSync(path.join(root,'player/調査員の徽章.md'), '---\ntitle: 調査員の徽章\n---\n既に受領した。');
  fs.writeFileSync(path.join(root,'world/港の地図/README.md'), '---\ntitle: 港の地図\nrequires:\n  items:\n    - player/調査員の徽章.md\nroll_dice:\n  result: 8\n---\n霧が晴れた。');
  const file = path.join(root,'.airpworld/canvas.db');
  let db = new DatabaseSync(file);
  db.exec('CREATE TABLE cards (id TEXT PRIMARY KEY, layer TEXT, x REAL, height REAL);');
  db.prepare('INSERT INTO cards VALUES (?, ?, ?, ?)').run('player/調査員の徽章.md','world/港の地図',123,456);
  db.close();
  const backup = path.join(temp,'backup');
  migrate(root,backup,true);
  assert.ok(fs.existsSync(path.join(backup,'player/調査員の徽章.md')));
  assert.deepEqual(fs.readdirSync(path.join(root,'player')),['investigator-badge.md']);
  const readme = fs.readFileSync(path.join(root,'world/harbor-chart/README.md'),'utf8');
  assert.match(readme,/title: 港の地図/); assert.match(readme,/result: 8/); assert.match(readme,/player\/investigator-badge.md/);
  db = new DatabaseSync(file);
  const row = db.prepare('SELECT * FROM cards').get();
  assert.equal(row.id,'player/investigator-badge.md'); assert.equal(row.layer,'world/harbor-chart');
  assert.equal(row.x,123); assert.equal(row.height,456); db.close();
  assert.equal(migrate(root,'',false).renames,0);
});
test('unknown paths and collisions are rejected without changing originals', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'airp-path-conflict-'));
  fs.writeFileSync(path.join(root,'未知.md'),'original');
  assert.throws(()=>migrate(root,'',false),/Unmapped/);
  assert.equal(fs.readFileSync(path.join(root,'未知.md'),'utf8'),'original');
  const other = fs.mkdtempSync(path.join(os.tmpdir(),'airp-path-collision-'));
  fs.writeFileSync(path.join(other,'依頼書.md'),'old'); fs.writeFileSync(path.join(other,'commission-letter.md'),'new');
  assert.throws(()=>migrate(other,'',false),/Collision/);
});
test('future generation targets use the same stable mapping', () => {
  assert.equal(mappedPath('world/港の地図/霧の向こう/README.md'),'world/harbor-chart/beyond-the-fog/README.md');
  assert.equal(textRefs('最後に player/今夜の手紙.md を書く。'),'最後に player/tonight-letter.md を書く。');
});
