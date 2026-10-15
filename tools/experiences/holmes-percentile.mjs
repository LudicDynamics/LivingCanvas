// Targeted template migration. Never rewrites player saves or translated rewards.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, stringifyFrontmatter } from '../../packages/shared/dist/index.js';
export function migrateHolmesPercentile(root) {
  let changed = 0;
  for (const name of ['whitechapel', 'whitechapel-jp']) {
    const dir = path.join(root, 'templates', name, 'world');
    if (!fs.existsSync(dir)) continue;
    for (const relative of fs.readdirSync(dir, { recursive: true })) {
      if (!String(relative).endsWith('04-investigation-dice.md')) continue;
      const file = path.join(dir, String(relative)); const p = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      const fm = p.frontmatter;
      if (fm?.roll_dice?.type !== '2d10' || fm.roll_dice.result !== undefined || !Array.isArray(fm.dice_outcomes) || fm.dice_outcomes.length !== 4) continue;
      const old = fm.dice_outcomes;
      const ranges = [[1,12],[13,60],[61,95],[96,100]];
      fm.dice_outcomes = [old[3],old[2],old[1],old[0]].map((band, i) => ({...band,min:ranges[i][0],max:ranges[i][1]}));
      fm.roll_dice = {...fm.roll_dice,type:'1d100',expect:'<=60'};
      const rules = name.endsWith('-jp')
        ? '1d100：低い数字ほど良い結果です。調査成功率60%、60以下で成功。\n1–12（12%）：大成功。追加の発見を含む記録を得ます。\n13–60（48%）：成功。手掛かりの意味と次の手順を得ます。\n61–95（35%）：失敗。見落としと次の手掛かりを記録します。\n96–100（5%）：重大な失敗。気付かれて調査の機会を失いますが、唯一の道は閉ざされません。'
        : '1d100: Lower is better. Investigation chance is 60%; 60 or below succeeds.\n1–12 (12%): Great success, including an additional discovery.\n13–60 (48%): Success; understand the clue and the next step.\n61–95 (35%): Failure; record the oversight and a way forward.\n96–100 (5%): Severe failure; you are noticed and lose an opportunity, but the only path forward stays open.';
      const body = p.body.replace(/2d10[^\n]*\n(?:[^\n]+\n?){4}/, rules + '\n');
      fs.writeFileSync(file, stringifyFrontmatter(fm, body)); changed++;
    }
  }
  return changed;
}
