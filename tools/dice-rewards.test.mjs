import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md } from './experiences/common.mjs';
import { parseFrontmatter } from '../packages/shared/dist/index.js';
import { runDeclaredRoll } from '../apps/server/dist/engine/declared-actions.js';
function fixture(score) {
  const source = 'world/check.md', reward = 'world/clue.md', events = [], files = new Map(); let rolls = 0;
  files.set(source, md({ type: 'chalk', roll_dice: { type: '2d10', expect: '>=11', desc: 'Investigate' }, dice_outcomes: [[2,4],[5,10],[11,17],[18,20]].map(([min,max]) => ({ min,max,text:'Observed fact', options:[{id:'back',label:'Back',action:{kind:'reply',text:'Back'}}], ...(min>=11?{rewards:[{path:reward,title:'Clue',body:'Observed fact'}]}:{}) })) }, 'Rules'));
  const edit = async ({path,frontmatter,body}) => { const p=parseFrontmatter(files.get(path)); files.set(path,md({...p.frontmatter,...frontmatter},body??p.body)); };
  const svc = {ctx:{store:{readFile:async p=>files.get(p),statKind:async p=>files.has(p)?'file':'missing',getEventsSince:async()=>events}}, editEntity:edit,
    rollDice:async()=>{rolls++; await edit({path:source,frontmatter:{roll_dice:{type:'2d10',expect:'>=11',desc:'Investigate',result:score,passed:score>=11}}});return {details:{dice:'2d10',rolls:[10,score-10],result:score,passed:score>=11}};},
    createEntity:async({path,frontmatter,body})=>{files.set(path,md(frontmatter,body));events.push({type:'entity_created',detail:{path}});},
  };
  return {svc,files,events,source,reward,rolls:()=>rolls};
}
test('successful reward is a portable item and is created only once after collection', async()=>{
  const f=fixture(18); const r=await runDeclaredRoll(f.svc,f.source);
  assert.equal(r.details.outcomeGrade,'great-success');
  assert.equal(parseFrontmatter(f.files.get(f.reward)).frontmatter.portable,true);
  f.files.set('player/clue.md',f.files.get(f.reward)); f.files.delete(f.reward);
  f.events.push({type:'entity_moved',detail:{from:f.reward,to:'player/clue.md'}});
  await runDeclaredRoll(f.svc,f.source);
  assert.equal(f.rolls(),1); assert.equal(f.events.filter(e=>e.type==='entity_created').length,1); assert.equal(f.files.has(f.reward),false);
});
test('reward collision does not overwrite another item or reroll on retry', async()=>{
  const f=fixture(12); f.files.set(f.reward,md({title:'Existing'},'Keep me'));
  await assert.rejects(()=>runDeclaredRoll(f.svc,f.source),/different item/);
  await assert.rejects(()=>runDeclaredRoll(f.svc,f.source),/different item/);
  assert.equal(f.rolls(),1); assert.match(f.files.get(f.reward),/Keep me/);
});
test('a reward can carry its picture: the created item gets `image` (dice finds used to lose their art)', async()=>{
  const f=fixture(18);
  const src=parseFrontmatter(f.files.get(f.source));
  for (const band of src.frontmatter.dice_outcomes) for (const r of band.rewards ?? []) r.image='assets/items/clue.webp';
  f.files.set(f.source, md(src.frontmatter, src.body));
  await runDeclaredRoll(f.svc,f.source);
  assert.equal(parseFrontmatter(f.files.get(f.reward)).frontmatter.image,'assets/items/clue.webp');
});
test('a reward image outside assets/ (or not an image) is refused', async()=>{
  const f=fixture(18);
  const src=parseFrontmatter(f.files.get(f.source));
  for (const band of src.frontmatter.dice_outcomes) for (const r of band.rewards ?? []) r.image='../secret.webp';
  f.files.set(f.source, md(src.frontmatter, src.body));
  await assert.rejects(()=>runDeclaredRoll(f.svc,f.source),/Invalid dice reward/);
});
