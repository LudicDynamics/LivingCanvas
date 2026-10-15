import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { JAPANESE_RULES } from './experiences/common.mjs';

// Stable IDs only. Display names and narrative prose remain Japanese.
export const names = {
  '01-目の前のこと':'01-opening','02-二つの航跡':'02-two-wakes','02-今夜の返事':'02-tonight-response',
  '02-名付ける前に':'02-before-naming','02-推論と作戦':'02-deduction-and-plan','02-雪宿りの灯り':'02-snow-shelter-light',
  'ぜんまいの蛙':'clockwork-frog','セラフィナ':'seraphina','リクエスト用紙':'request-slip',
  'ロンドンの地図':'london-map','ワトソン':'watson','ワトソンの封書':'watson-letter','ヴェラ':'vera',
  '一九九四年':'1994','七海':'nanami','七海との約束':'promise-with-nanami','七番埠頭':'seventh-berth',
  '三件目の現場':'third-crime-scene','三十年後':'thirty-years-later','世界の遊び方':'world-guide',
  '人物':'personality','今夜':'tonight','今夜の手紙':'tonight-letter','今夜の約束':'tonight-promises',
  '住人':'residents','依頼書':'commission-letter','初雪':'first-snow','印刷所':'print-shop','受領票':'receipt',
  '古い灯台':'old-lighthouse','司書':'librarian','咒文の図譜':'spell-atlas','存在しない通り':'unnamed-street',
  '小さな手鏡':'small-hand-mirror','届かなかった手紙':'undelivered-letter','屋上':'rooftop','工房':'workshop',
  '常盤電器':'tokiwa-electronics','幼いリョウ':'young-ryo','戻り口':'return-gate','拾い物':'found-object',
  '改稿の切れ端':'revision-scrap','放送室':'radio-studio','新入生の名札':'freshman-badge','星の欠片':'star-fragment',
  '映すの断片':'reflection-fragment','時刻の記録':'time-record','時間の地図':'time-map','検視室':'morgue',
  '欠席の痕跡':'absence-trace','水位の痕跡':'waterline-trace','港の地図':'harbor-chart','澄との約束':'promise-with-sumi',
  '灯台日誌':'lighthouse-logbook','灯油':'lamp-oil','現在の痕跡':'present-trace','琥珀カフェ':'amber-cafe',
  '紋章の留め具':'crest-clasp','老モー':'old-mo','記憶':'memory','調査員の徽章':'investigator-badge',
  '銀鳶':'silver-kite','開くの断片':'opening-fragment','雪宿り':'snow-shelter','雪村澄':'sumi-yukimura',
  '青い真鍮の蓋':'blue-brass-cap','顔料の記録':'pigment-record','あなた':'player',
  '03-投光の条件':'03-lighting-terms','霧の向こう':'beyond-the-fog','灯台道':'lighthouse-road','紹介状':'introduction-letter',
  '推論':'deduction','作戦計画':'operation-plan','03-実行前の確認':'03-execution-terms',
  '四枚目の外':'outside-the-fourth-frame','実行の記録':'execution-record','残った物':'remaining-object',
  '01-絵が外れる':'01-missed-frame','事件の受領証':'case-receipt',
  '送信原稿':'fax-draft','送信前の記録':'before-transmission','ＦＡＸ受信票':'fax-receipt','新しい現在':'new-present',
  '失った物':'lost-object','01-受信のあと':'01-after-reception','後日談':'epilogue','01-灯りの下':'01-under-the-light',
  '魔法の草稿':'spell-draft','03-施法の条件':'03-casting-terms','星図になった部屋':'star-chart-room',
  '掌の星空':'palm-stars','変わった空間':'changed-space','代価の痕跡':'cost-trace','01-自分の魔法':'01-my-spell',
  '天文台':'observatory','名付けた星図':'named-star-chart',
  '04-留め具の紋章':'04-clasp-crest','02-擦り跡の記録':'02-scrape-record','03-空箱の答え':'03-empty-crate-answer',
  '02-日誌の十二分':'02-twelve-logbook-minutes','02-ヴェラの持ち主':'02-vera-owner',
};
export function segment(s) {
  const ext = /\.(md|json|jsonl)$/.exec(s)?.[0] ?? '';
  const stem = ext ? s.slice(0, -ext.length) : s;
  if (names[stem]) return names[stem] + ext;
  for (const [old, next] of Object.entries(names).sort((a,b)=>b[0].length-a[0].length)) {
    if (stem.endsWith(`-${old}`)) return stem.slice(0, -old.length) + next + ext;
  }
  return s;
}
export const mappedPath = p => p.split('/').map(segment).join('/');
export function textRefs(text) {
  let next = text.replace(/(?:[A-Za-z0-9_.-]+\/)*(?:world|player|characters|skills|\.airpworld)\/[\p{L}\p{N}_.\/*~-]+/gu, mappedPath);
  for (const [old, name] of Object.entries(names)) next = next.replaceAll(`${old}.md`, `${name}.md`);
  return next;
}
const idKeys = new Set(['id','characterId','character_id','preset','profile','subject','focus','actor']);
export function jsonRefs(value, key = '') {
  if (typeof value === 'string') return idKeys.has(key) ? segment(textRefs(value)) : textRefs(value);
  if (Array.isArray(value)) return value.map(v=>jsonRefs(v,key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[textRefs(k),jsonRefs(v,k)]));
  return value;
}
function walk(root, rel = '') {
  return fs.readdirSync(path.join(root,rel),{withFileTypes:true}).flatMap(e=> {
    if (['assets','.git','node_modules'].includes(e.name) || e.isSymbolicLink()) return [];
    const p = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? [p,...walk(root,p)] : [p];
  });
}
function rewrite(raw, file) {
  if (file.endsWith('.json')) return JSON.stringify(jsonRefs(JSON.parse(raw)),null,2)+'\n';
  if (file.endsWith('.jsonl')) return raw.split('\n').map(l=>l.trim()?JSON.stringify(jsonRefs(JSON.parse(l))):l).join('\n');
  let result = textRefs(raw);
  if (file.endsWith('/SKILL.md')) result = result.replace(/^name: world-play$/m, `name: ${path.basename(path.dirname(mappedPath(file)))}`);
  result = result.replaceAll('日本語名の新しい道と町の入口', '英語の安定したディレクトリ ID と日本語 title を持つ新しい道と町の入口');
  // Replace the superseded language paragraph, keeping world-specific play
  // rules and any player-written additions intact.
  if (/^## 言語と知識$/m.test(result)) result = result.replace(/(## 言語と知識\n)[\s\S]*?(?=\n\n## 行動の完了)/,
    '$1' + JAPANESE_RULES.split('## 言語と知識\n')[1].split('\n\n## 行動の完了')[0]);
  // Only structural frontmatter IDs, never display names or prose.
  result = result.replace(/^(character|characterId|id|preset):\s*["']?([^\n"']+)["']?\s*$/gm, (line,k,v)=>`${k}: ${JSON.stringify(segment(v.trim()))}`);
  const stem = path.basename(file,'.md');
  if (names[stem] && !/^title:|^name:/m.test(raw.split('\n---')[0])) {
    result = result.startsWith('---\n') ? result.replace('---\n',`---\ntitle: ${JSON.stringify(stem)}\n`) : `---\ntitle: ${JSON.stringify(stem)}\n---\n\n${result}`;
  }
  return result;
}
function migrateDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  try {
    for (const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      const q = s => '"'+s.replaceAll('"','""')+'"';
      const columns = db.prepare(`PRAGMA table_info(${q(name)})`).all();
      const keys = columns.filter(c=>c.pk).map(c=>c.name);
      if (!keys.length) continue;
      for (const row of db.prepare(`SELECT * FROM ${q(name)}`).all()) {
        const changed = {};
        for (const [k,v] of Object.entries(row)) if (typeof v === 'string') {
          let next;
          try { next = JSON.stringify(jsonRefs(JSON.parse(v))); } catch { next = idKeys.has(k) ? segment(textRefs(v)) : textRefs(v); }
          if (next !== v) changed[k] = next;
        }
        const cols = Object.keys(changed);
        if (cols.length) db.prepare(`UPDATE ${q(name)} SET ${cols.map(k=>q(k)+'=?').join(',')} WHERE ${keys.map(k=>q(k)+'=?').join(' AND ')}`).run(...cols.map(k=>changed[k]),...keys.map(k=>row[k]));
      }
    }
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; } finally { db.close(); }
}
export function migrate(root, backup, apply = false) {
  root = path.resolve(root);
  const files = walk(root);
  const renames = files.filter(p=>mappedPath(p)!==p);
  for (const file of files) {
    if (/[^\x00-\x7f]/.test(mappedPath(file))) throw Error(`Unmapped path: ${file}`);
    if (file !== mappedPath(file) && fs.existsSync(path.join(root,mappedPath(file)))) throw Error(`Collision: ${file}`);
  }
  const writes = files.filter(p=>/\.(md|json|jsonl)$/.test(p) && fs.statSync(path.join(root,p)).isFile()).map(p=>[p,rewrite(fs.readFileSync(path.join(root,p),'utf8'),p)]).filter(([p,s])=>s!==fs.readFileSync(path.join(root,p),'utf8'));
  if (!apply) return {root,renames:renames.length,writes:writes.length};
  if (!backup || fs.existsSync(backup)) throw Error('A new, nonexisting backup destination is required');
  backup = path.resolve(backup);
  if (backup.startsWith(root + path.sep)) throw Error('Backup must be outside the world');
  const stage = path.join(path.dirname(root), `.path-migration-${randomUUID()}`);
  // Work on a private copy. Originals (including all assets and databases) are
  // moved to the backup only after every rewrite and DB transaction succeeds.
  fs.cpSync(root, stage, {recursive:true,mode:fs.constants.COPYFILE_FICLONE});
  for (const [p,s] of writes) fs.writeFileSync(path.join(stage,p),s);
  for (const p of files.filter(p=>p.endsWith('.db'))) migrateDb(path.join(stage,p));
  // Deepest entries first; rename each basename after its children.
  for (const p of files.sort((a,b)=>b.split('/').length-a.split('/').length)) {
    const name = path.basename(p), next = segment(name);
    if (next !== name) fs.renameSync(path.join(stage,p),path.join(stage,path.dirname(p),next));
  }
  fs.mkdirSync(path.dirname(backup), {recursive:true});
  fs.renameSync(root, backup);
  try { fs.renameSync(stage, root); }
  catch (error) { fs.renameSync(backup, root); throw error; }
  return {root,renames:renames.length,writes:writes.length,backup};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const templatesOnly = !process.argv.includes('--include-saves');
  const backup = process.argv.find(a=>a.startsWith('--backup='))?.slice(9);
  if (apply && !backup) throw Error('--backup is required');
  if (apply) {
    const running = await new Promise(resolve => {
      const socket = net.connect({host:'127.0.0.1',port:3001});
      socket.once('connect',()=>{socket.destroy();resolve(true);});
      socket.once('error',error=>{socket.destroy();resolve(error.code !== 'ECONNREFUSED');});
    });
    if (running) throw Error('Stop the local server before migrating templates or saves');
  }
  const roots = [];
  for (const base of templatesOnly ? ['templates'] : ['templates','worlds']) for (const name of fs.readdirSync(base)) {
    const root = path.join(base,name), manifest = path.join(root,'world.json');
    if (!name.includes('-playtest') || !fs.existsSync(manifest)) continue;
    roots.push({root,backup:backup?path.join(backup,base,name):''});
  }
  // Fail on unknown IDs/collisions before changing any world.
  for (const r of roots) migrate(r.root, '', false);
  for (const r of roots) console.log(JSON.stringify(migrate(r.root,r.backup,apply)));
}
