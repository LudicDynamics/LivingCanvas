import { parseFrontmatter } from '../../packages/shared/dist/index.js';
import { md } from './common.mjs';
import { investigationCards } from './investigation-dice.mjs';
const read = (...paths) => ({ kind: 'read', paths });
const take = (...paths) => ({ kind: 'take', paths });
const stage = (...paths) => ({ kind: 'stage', slots: paths.map((p, i) => ({
  id: `material-${i + 1}`,
  title: ({ 'deduction.md': '推論と根拠', 'operation-plan.md': '安全な実行計画', 'fax-draft.md': '送信前のＦＡＸ草稿', 'spell-draft.md': '魔法と代価の提案', 'waterline-trace.md': '喫水線の記録', 'crest-clasp.md': '留め具の証拠', 'lighthouse-logbook.md': '灯台日誌' })[p.split('/').pop()] ?? `資料 ${i + 1}`,
  required: ['deduction.md', 'operation-plan.md', 'fax-draft.md', 'spell-draft.md'].includes(p.split('/').pop()),
  paths: [p],
})) });
const talk = character => ({ kind: 'character', character });
const enter = target => ({ kind: 'enter', target });
const reply = text => ({ kind: 'reply', text });
const authoredOption = o => ({ id: o.id, label: o.label, ...(o.when ? { when: o.when } : {}), ...(o.hint ? { hint: o.hint } : {}) });
const h = 'world/london-map', w = 'world/harbor-chart', a = 'world/spell-atlas';
const past = 'world/time-map/1994/tokiwa-electronics', now = 'world/time-map/tonight/tokiwa-electronics';
// Authoring-time bindings, never guessed from button text at runtime.
const bindings = {
  wuwu: {
    '依頼書と徽章を受け取る': take('world/commission-letter.md', 'world/investigator-badge.md'),
    '依頼の条件を読む': read('world/commission-letter.md'),
    '擦り跡を記録する': read(`${w}/seventh-berth/waterline-trace.md`),
    '銀鳶に箱のことを尋ねる': talk('silver-kite'),
    '留め具の紋章を調べる': read(`${w}/workshop/crest-clasp.md`),
    'ヴェラに持ち主を尋ねる': talk('vera'),
    '灯台日誌を読む': read(`${w}/old-lighthouse/lighthouse-logbook.md`),
    '油を借り、照らし方を相談する': talk('old-mo'),
    '調査材料と照らす方法を提出する': stage(`${w}/seventh-berth/waterline-trace.md`, `${w}/workshop/crest-clasp.md`, `${w}/old-lighthouse/lighthouse-logbook.md`),
    'まだ調べる': enter(w),
  },
  whitechapel: {
    'ワトソンの封書と四枚目を読む': read('world/watson-letter.md', 'world/fourth-illustration.md'),
    '依頼を引き受け、真鍮の蓋を持つ': take('world/blue-brass-cap.md'),
    '絵と現場の違いを調べる': read(`${h}/third-crime-scene/pigment-record.md`),
    '画筒の蓋と顔料を比べる': read('player/blue-brass-cap.md', `${h}/third-crime-scene/pigment-record.md`),
    '発見時刻と挿絵の納品時刻を比べる': read(`${h}/morgue/time-record.md`, `${h}/print-shop/receipt.md`),
    'トムに原稿と挿絵の順番を聞く': talk('tom'),
    '受領票と当直帳を読む': read(`${h}/print-shop/receipt.md`, `${h}/print-shop/shift-ledger.md`),
    '訂正稿を誰に回したか聞く': talk('blackburn'),
    '訂正稿の回覧記録を読む': read(`${h}/print-shop/editor-office/correction-log.md`),
    'ウェインに手首と絵の納品について聞く': talk('wayne'),
    '訂正された住所を読んだか確かめる': talk('wayne'),
    '住所を変えた理由を聞く': talk('edith'),
    '誰に訂正稿を渡したか聞く': talk('edith'),
    '架空の住所と回覧記録を照合する': read(`${h}/unnamed-street/revision-scrap.md`, `${h}/print-shop/editor-office/correction-log.md`),
    '安全に相手を呼ぶ方法をワトソンへ相談する': talk('watson'),
    '整理した内容を確認する': stage('player/deduction.md', 'player/operation-plan.md'),
  },
  divergence: {
    'ぜんまいの蛙を持つ': take('world/clockwork-frog.md'),
    '届かなかった手紙を読む': read('world/undelivered-letter.md'),
    '事故の知らせを読む': read('world/accident-notice.md'),
    '受け取りの約束と帰り道を聞く': talk('young-ryo'),
    '用意したＦＡＸを確認する': stage('player/fax-draft.md'),
    'ＦＡＸが届く時刻を調べる': read(`${now}/fax-machine.md`),
    '目の前の店と人を確かめる': read('world/time-map/thirty-years-later/tokiwa-electronics/shop-record.md'),
    '店がなくなった理由を読む': read('world/time-map/thirty-years-later/tokiwa-electronics/shop-record.md'),
    '時間の地図へ戻る': enter('world/time-map'),
  },
  'first-snow-jp': {
    '用紙を手に取って読む': take('world/request-slip.md'),
    '七海に今の気持ちを尋ねる': talk('nanami'),
    '澄が話したかったことを尋ねる': talk('sumi-yukimura'),
    '昔の約束を思い出す': read('world/tonight-promises/promise-with-nanami.md'),
    'まだ話したいことがある': enter('world/tonight-promises'),
  },
  'magic-academy': {
    '名札を受け取る': take('world/freshman-badge.md'),
    'セラフィナに失敗した魔法を尋ねる': talk('seraphina'),
    '使える物を調べる': read(`${a}/star-fragment.md`, `${a}/small-hand-mirror.md`, `${a}/reflection-fragment.md`),
    '提案した魔法の代価を確かめる': stage('player/spell-draft.md'),
  },
  'unwritten-door': {
    'Examine the outside': reply('The handwriting on the envelope is unfamiliar. The seal is intact. Looking at the outside has not opened it or revealed a name.'),
  },
};

export function bindFile(base, file, text) {
  if (!file.endsWith('.md') || file.endsWith('SKILL.md')) return text;
  const parsed = parseFrontmatter(text);
  if (!parsed.interactive.choice) return text;
  const fm = parsed.frontmatter;
  // One button describes one operation; opening prose already states the task.
  let normalized = false;
  for (const [id, action] of Object.entries(fm.choice_actions ?? {})) {
    if (action.kind === 'stage' && !action.slots && Array.isArray(action.paths)) {
      fm.choice_actions[id] = stage(...action.paths);
      normalized = true;
    }
  }
  for (const o of parsed.interactive.choice.options) {
    if (base === 'divergence' && o.label === '手紙を読み、ぜんまいの蛙を持つ') { o.label = 'ぜんまいの蛙を持つ'; normalized = true; }
    if (base === 'magic-academy' && o.label === '名札を受け取り、課題を聞く') { o.label = '名札を受け取る'; normalized = true; }
  }
  if (base === 'divergence' && parsed.interactive.choice.options.some(o => o.label === 'ぜんまいの蛙を持つ') && !parsed.interactive.choice.options.some(o => o.id === 'read-letter')) {
    parsed.interactive.choice.options.push({ id: 'read-letter', label: '届かなかった手紙を読む' });
    if (fm.choice_actions) fm.choice_actions['read-letter'] = read('world/undelivered-letter.md');
    normalized = true;
  }
  // Existing declarative recipes (including resolved dice) remain authoritative.
  if (fm.choice_actions) return normalized ? md({ ...fm, choice: { ...fm.choice, options: parsed.interactive.choice.options.map(authoredOption) } }, parsed.body) : text;
  const old = typeof fm.choice === 'object' && !Array.isArray(fm.choice) ? fm.choice : {};
  const actions = {};
  const options = parsed.interactive.choice.options.map((option, i) => {
    const id = option.id ?? `action-${i + 1}`;
    actions[id] = bindings[base]?.[option.label] ?? { kind: 'writer' };
    return authoredOption({ ...option, id });
  });
  return md({ ...fm, choice: { ...old, options }, choice_actions: actions }, parsed.body);
}

export const actionRules = locale => locale === 'ja' ? `
## 確定操作と作家の分離（現行）
choice_actions は実装済みのUI操作宣言。choice.optionsの英語idに対応する。read(paths)、take(paths)、stage(paths)、enter(target)、character(character)、reply(text)、writer(promptは任意)だけを使う。読む・運ぶ・既存場面へ戻る・材料を並べる・骰子結果の短い表示で作家を起動しない。stageは材料の確認だけで、提出や実行ではない。生成、自由RP、未確定の約束や作戦を実行する時だけwriterにする。人物の質問はcharacterで対話を開き、勝手に台詞を送らない。
生成する新しいChalkにも選択ごとのidとchoice_actionsを付ける。読書や帰路を曖昧なwriter選択にしない。未来の素材パスを既存readとして宣言しない。未定義のaction種類、スクリプト、架空のAPIは書かない。UIの宣言は判断済みの操作であり、作家は重複実行しない。
` : `
## Direct actions and writer turns
choice_actions maps stable choice.options IDs to implemented UI recipes: read(paths), take(paths), stage(paths), enter(target), character(character), reply(text), writer(optional prompt). Reading, taking, navigating existing scenes and staging materials do not invoke the writer. Stage does not submit or execute. Unknown content, new promises, fictional calls and generation still require explicit writer input. Add these bindings to new choices, preserving free RP. Never invent action kinds, script execution or references to nonexistent readable files.
`;

export function decouplePack(pack) {
  const files = Object.fromEntries(Object.entries(pack.files).map(([f, text]) => [f, bindFile(pack.base, f, text)]));
  const extra = investigationCards(pack.base);
  Object.assign(files, extra.files);
  for (const [scene, dicePath] of Object.entries(extra.entryPoints)) {
    for (const file of [`${scene}/README.md`, `${scene}/01-opening.md`, ...extra.boards.filter(f => f.startsWith(`${scene}/`) && f.slice(scene.length + 1).indexOf('/') < 0)]) {
      if (!files[file]) continue;
      const p = parseFrontmatter(files[file]);
      const options = p.interactive.choice?.options.map(authoredOption) ?? [];
      if (options.some(o => o.id === 'investigate-with-dice')) continue;
      options.unshift({ id: 'investigate-with-dice', label: '骰子で調べる · 推理を任せる' });
      files[file] = md({ ...p.frontmatter, choice: { options, allow_free: true }, choice_actions: { ...p.frontmatter.choice_actions, 'investigate-with-dice': read(dicePath) } }, p.body);
    }
  }
  const skill = `skills/${pack.id}-play/SKILL.md`;
  const marker = pack.locale === 'ja' ? '## 確定操作と作家の分離（現行）' : '## Direct actions and writer turns';
  if (!files[skill].includes(marker)) files[skill] += actionRules(pack.locale) + extra.rules;
  return { ...pack, files };
}
