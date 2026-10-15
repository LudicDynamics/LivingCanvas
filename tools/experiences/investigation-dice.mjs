import { md } from './common.mjs';
const option = (id, label, action) => ({ id, label, action });
const writer = prompt => ({ kind: 'writer', prompt });
const read = paths => ({ kind: 'read', paths });
const enter = target => ({ kind: 'enter', target });

// Fixed facts are authored here; dice decide how the character discovers them.
export function investigationCards(base) {
  const files = {}, entryPoints = {}, boards = [];
  if (!['wuwu', 'whitechapel'].includes(base)) return { files, entryPoints, boards, rules: '' };
  const isWuwu = base === 'wuwu', map = isWuwu ? 'world/harbor-chart' : 'world/london-map';
  const points = isWuwu ? [
    [`${map}/seventh-berth`, '擦り跡を読み解く', '擦り跡は満潮より高い。水位だけでなく、別の船が横から押した可能性を調べられる。', [`${map}/seventh-berth/waterline-trace.md`]],
    [`${map}/workshop`, '留め具の意味をつなぐ', 'これは領主家の紋章がある舵の部品。無人船の積荷ではなく、操舵に関わる持ち主を追う手掛かりだ。', [`${map}/workshop/crest-clasp.md`]],
    [`${map}/old-lighthouse`, '十二分の意味をつかむ', '消灯した十二分は税関トンネルの出口と潮が重なる時間。老モーが見ていない船を知っていた証明ではなく、通行の機会だ。', [`${map}/old-lighthouse/lighthouse-logbook.md`]],
  ] : [
    [`${map}/third-crime-scene`, '構図の違和感を見抜く', '椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。', [`${map}/third-crime-scene/pigment-record.md`]],
    [`${map}/morgue`, '絵と事件の順番を解く', '納品は昨日十八時、事件は今朝六時。絵は事件より先だ。現場を見てから描いたという説明では順番が合わない。', [`${map}/morgue/time-record.md`, `${map}/print-shop/receipt.md`]],
    [`${map}/print-shop`, '原稿の流れをつかむ', '原稿は編集者から画家へ渡り、絵は事件前に納品された。作品を先に知る人物と、事件後に知る人物を区別できる。', [`${map}/print-shop/receipt.md`]],
    [`${map}/print-shop/editor-office`, '訂正稿の行き先を追う', '編集者は八時に受け取り、八時十五分にウェインへ回した。訂正住所は作者と編集者だけの秘密ではなかった。', [`${map}/print-shop/editor-office/correction-log.md`]],
    [`${map}/print-shop/illustration-room`, '画家の説明を検証する', '新しい右手の包帯、群青の袖口、事件前に届いた絵。ウェインを重点的に調べる根拠になるが、怪我だけで逮捕はできない。', [`${map}/print-shop/illustration-room/visible-details.md`]],
    [`${map}/edith-room`, '架空の住所の意図を解く', 'イーディスは架空の住所で反応を試した。そこへ人を呼ぶ計画ではない。誰へ訂正が渡ったかを追おう。', [`${map}/edith-room/address-correction.md`]],
    [`${map}/unnamed-street`, '待ち伏せできる場所を選ぶ', '架空の通りには行けない。実在する中庭を使い、編集者に住所確認の仲介を頼める。イーディス本人を囮にする必要はない。', [`${map}/unnamed-street/meeting-options.md`]],
  ];
  const add = (scene, title, fact, paths, main = false) => {
    const file = `${scene}/04-investigation-dice.md`;
    entryPoints[scene] = file;
    const next = main ? (success, great) => [option('play-result', success ? '発見の先へ進む' : '手掛かりから別の道を試す', writer(isWuwu
      ? `判定元 ${file} の実際の出目と本文を読む。これは解読を代行する承諾済みの骰子ルート。証拠二点や照らす方法の作文は要求しない。${success ? '二隻目の船影から world/harbor-chart/beyond-the-fog/ に最初の岸道を生成する。' : '空振りの代価を残して world/harbor-chart/tidal-approach/ に潮痕を追う短い場面を生成する。そこから新しい道の発見を続けられる。'}${great ? '大成功で見つけた接応の合図を次の場面に反映する。' : ''} README・物二つ・行動付きChalk・戻り門を揃え、必要な画像は後で一枚。本文済みなら再生成しない。`
      : `判定元 ${file} を読む。プレイヤーはホームズの推理を骰子に任せ、この安全な案を試す：ウェインを重点的に調べ、編集者へ中庭での住所確認を依頼し、イーディスは221Bで保護、ワトソンと合図・退路を相談する。二つの作文や正解文は不要。この送信を試行の確認として扱う。${success ? '得た観察を使って設局を進める。' : 'この場面は見逃しや相手の拒否を含む短い失敗／部分成果にする。'}固定の真犯人は変えず、相手の返答や拒否も演じる。既存の結末規約で結果場面と帰路を作る。`)), option('back', '調査へ戻る', enter(map))]
      : () => [option('read-clue', '手掛かりを読む', read(paths)), option('back', '地図へ戻る', enter(map))];
    const bands = [
      [2, 4, `調査の物音が響き、気付かれずに調べる機会を失った。まだ糸口はある。${fact}`, false, false],
      [5, 10, `すぐには結び付かなかったが、手掛かりを見直す方向はつかめた。${fact}`, false, false],
      [11, 17, `観察がつながった。${fact}`, true, false],
      [18, 20, `核心だけでなく、次に確かめる手順まで見えた。${fact}${main ? ' 次の場面では、この余裕を具体的な追加の観察機会にする。' : ' 原本を示して質問すれば、推測と証言を分けて確かめられる。'}`, true, true],
    ];
    const preview = `難しい時は、ダイスで登場人物に調査を任せられます。自分で考えたい時は、振らずに戻っても大丈夫です。\n\n2d10：十面ダイスを二つ振ります。合計11以上で成功です。調べる時の見落としや、偶然の発見を表します。\n2–4（6%）：物音で誰かに気づかれます。こっそり調べる機会を失いますが、手掛かりは残ります。\n5–10（39%）：すぐには解けません。次に何を調べればよいか分かります。物は失いません。\n11–17（49%）：成功。手掛かりの意味と、次にすることが分かります。\n18–20（6%）：大成功。さらに、次の調査に役立つ発見があります。\n\n失敗しても、ここで行き止まりにはなりません。同じダイスの振り直しはできません。結果を見てから、続きを選べます。新しい場所を作る時だけ、作家への送信が必要です。`;
    const resolvedBands = isWuwu ? bands : [
      [1, 12, bands[3][2], true, true], [13, 60, bands[2][2], true, false],
      [61, 95, bands[1][2], false, false], [96, 100, bands[0][2], false, false],
    ];
    const percentilePreview = '難しい時は、ホームズの調査を百分ダイスに任せられます。自分で推理したい時は、振らずに戻っても大丈夫です。\n\n1d100：数字が小さいほど良い結果です。調査成功率は60%、60以下で成功。\n1–12：大成功。核心と追加の発見を記録します。\n13–60：成功。手掛かりの意味が分かります。\n61–95：失敗。見落としを記録し、次の調査へ進めます。\n96–100：重大な失敗。物音で気付かれ、こっそり調べる機会を失います。\n\n失敗しても真相は変わらず、唯一の道を閉ざしません。結果の記録を開き、必要なら持ち物へ収めてください。同じ判定の振り直しはできません。';
    files[file] = md({ type: 'chalk', title, roll_dice: { type: isWuwu ? '2d10' : '1d100', desc: title, expect: isWuwu ? '>=11' : '<=60' },
      choice: { options: [{ id: 'back', label: '今は振らずに地図へ戻る' }] }, choice_actions: { back: enter(map) },
      dice_outcomes: resolvedBands.map(([min, max, text, success, great]) => ({ min, max, text, options: next(success, great),
        rewards: [{ path: `${scene}/investigation-${great ? 'great-success' : success ? 'success' : 'setback'}.md`, title: great ? '核心を記した覚え書き' : success ? '調査の覚え書き' : '見落としと次の手掛かり', body: text }],
      })),
    }, isWuwu ? preview : percentilePreview);
  };
  for (const args of points) add(...args);
  add(map, isWuwu ? '骰子で二つの航跡をつなぐ' : 'ホームズに推理を任せる', isWuwu
    ? '無人船だけでは擦り跡と消灯の時間を説明しきれない。もう一隻と税関側の通行を追う。'
    : 'ウェインが文章を先に読み、描いた構図へ事件を合わせた疑いが最も強い。イーディスの住所訂正は探りだった。中庭で検証し、保護と証拠確保を分ける。', [], true);
  boards.push(isWuwu ? `${map}/02-two-wakes.md` : `${map}/02-deduction-and-plan.md`);
  return { files, entryPoints, boards, rules: `
## 骰子による解読代行（現行、手動解謎との並列）
各調査地点と地図の04-investigation-dice.mdは、プレイヤーの代わりにキャラクターが観察をつなぐルート。現実のプレイヤーが正解を説明する必要はない。地図の判定を直接選んでもよく、各地点の判定は必須順序ではない。真相は固定、出目は発見の方法・代価・余裕を変える。dice_outcomesは四段階の短い結果と次のchoice_actionsを既存の動作層で同じファイルへ反映する。作家は二重に反映・再判定・追加徴収しない。
このルートでは「独立した証拠二点」「推論と計画の二文書」は必須条件ではない。旧規則のそれらの要求は手動提出ルートだけ。低い出目でも足掛かりと次の行動を得る。地図の結果から新場面や結末を明示依頼された時だけ作家が生成する。未発見の人物を既に話したことにせず、読めた推理と会話の記録を区別する。生成待ちを骰子失敗扱いにしない。
` };
}
