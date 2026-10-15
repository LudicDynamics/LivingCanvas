// Authoring helpers only. Runtime state remains ordinary world files.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../packages/shared/package.json', import.meta.url));
const { stringify } = require('yaml');
export const md = (frontmatter, body = '') => `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n\n${body.trim()}\n`;
export function author(base, name, description, locale = 'ja') {
  const pack = { base, id: `${base}-playtest`, name, description, locale, files: {}, characters: [], scenes: [], checks: [] };
  pack.put = (file, fm, body) => { pack.files[file] = md(fm, body); };
  pack.scene = (dir, title, body, choices = [], extra = {}) => {
    const { appearance, ...sceneExtra } = extra;
    const fm = { type: dir === 'world' ? 'readme' : 'gate', name: title, title, ...sceneExtra };
    if (choices.length) fm.choice = choices;
    pack.put(`${dir}/README.md`, fm, body);
    const filename = locale === 'ja' ? '01-目の前のこと.md' : '01-first-sight.md';
    pack.put(`${dir}/${filename}`, { type: 'chalk', title, ...(choices.length ? { choice: choices } : {}), ...(sceneExtra.intent ? { intent: sceneExtra.intent } : {}), ...(appearance ? { appearance } : {}) }, body);
    pack.scenes.push(dir);
  };
  pack.note = (file, title, body, extra = {}) => pack.put(file, { type: 'note', title, portable: true, ...extra }, body);
  pack.person = (source, id, home, body) => pack.characters.push({ source, id, name: id, home, body });
  pack.rules = text => {
    const ruleDir = `${pack.id}-play`;
    pack.files[`skills/${ruleDir}/SKILL.md`] = md({ name: ruleDir, description: locale === 'ja' ? 'この世界の全ての行動、移動、判定、生成と回訪で必ず読む。世界の連続性と完成条件。' : 'Read for every action, entry, adjudication, generation and revisit in this world.' }, `${locale === 'ja' ? JAPANESE_RULES : ENGLISH_RULES}\n\n${text}`);
  };
  return pack;
}

export const JAPANESE_RULES = `# 世界の実行規則

これはファイルを実際に更新する遊び。台詞だけで成功を宣言しない。まず今回の行動元、現在地と親の README、その intent、関連する現物、人物の記憶、提供された既訪問の履歴を読む。README は場所と既知の出口、Chalk は今の選択と具体的な生成意図、この skill は世界の不変条件を持つ。intent は新しいエンジン命令ではなく作家への指示。

## 言語と知識
地の文、title、選択、生成指示は日本語。ファイル名、ディレクトリ名、人物 ID は英語の小文字 kebab-case で固定し、表示名をパスとして使わない。例：world/harbor-chart/beyond-the-fog/lighthouse-road/README.md、player/introduction-letter.md、characters/nanami/memory.md。README.md、SKILL.md、world.json、preset.json と既存の素材パスは保持。新規 Chalk にも英語の安定した path を渡し、title と本文を日本語にする。人物は目撃・伝聞した事実だけ知る。プレイヤーに見せていない秘密を後日談の思い出にしない。

## 行動の完了
一つの選択に具体的な一つの変化を返す。取ると言われた現物は move、読むだけなら動かさない。README は移動しない。人物を道具扱いしない。提出は参照であり、消費ではない。現物へのパスと、プレイヤーが言った意味を確認する。選択を押したことだけで未発言の推論・計画・告白を代筆しない。草稿の代筆はプレイヤーが依頼し、内容を確認した時だけ。

実行する前に、この行動で作るファイル・更新するファイル・最後の解放物を自分で列挙する。途中で文章を一つ書いて終わらず、全ファイルを読み返す。条件未達やツール失敗なら不足を伝え、解放物を発行しない。再試行は既存の結果を読み、不足だけ修復する。二重クリックで報酬や消費を重複させない。新しい世界状態ファイルは作らず、該当する物の本文と status.data の平坦な値で事実を残す。

## 判定
判定前には対象、必要な物、なぜ不確実か、式、成功条件、確率、通常成功、大成功、失敗と小確率の実害、振らず戻る選択を同じ Chalk に示す。roll_dice は必ず複数行の YAML で書く。インラインの {type:...} は結果の書き戻しに対応しない。expect は引用符付き。提出・入場だけでは roll_dice を呼ばない。プレイヤーが表示された条件を見て自分で振る。条件が変われば再提示。事実の真偽や相手の同意を骰子で決めない。既存 result を消して無料で振り直さない。

## 新しい場所を生成する時
親の README と入口 Chalk に明示された範囲だけ、一つの子フォルダを作る。普通の室内を調べるだけで町を増やさない。まず入口で見える一言、次に README、意味のある物二つ、行動付き Chalk、親へ戻る gate を書く。必要なら一つの物を新しい住人の紹介 note にする。名前・仕事・目撃できる言葉を残し、未登録 characterId の会話ボタンは作らない。作家がその出会いを演じる。

README の存在だけを完成扱いしない。子の README、物二つ、Chalk、戻り口を確認し、不足があれば同じ場所を修復する。回訪で場所や人物を再抽選しない。文字が完成してから generate_image を一回だけ呼び、実際の場所と同じ光・物・時刻の背景を要求する。返された実在 asset だけを README の bg に書く。画像失敗は文字の失敗にしない。失敗時は絵が未着と伝え、自動再試行しない。古い bgVideo が新しい絵と矛盾すれば外す。完成済みの文字で先に遊べる。1–2 分は演出予算であり、生成速度の約束ではない。`;

export const ENGLISH_RULES = `# World execution rules

Read this skill, the current and parent README, the action source and its intent, relevant actual objects, and supplied played history before acting. README defines the place and known exits; Chalk states the immediate action and generation intent; this skill defines continuity. The intent field is prose for the Writer, not another engine command.

All prose, prompts, ordinary folders and filenames are English. Keep protocol identifiers and existing asset paths. Narrate one concrete consequence of the action, not an invented player decision. Move an actual item only when taking it is requested. Reading is not possession. Submission does not consume an item. Do not treat a person as inventory.

Before writing, enumerate the files required by this action. Read them back before claiming completion; create any unlocking receipt LAST. On failure report missing pieces, keep the gate locked, and repair only missing pieces on retry. Repeated clicks do not grant duplicate rewards. Store facts in the relevant entity body and flat status.data, not a new state file.

Never roll automatically on entry or submission. Before any optional roll, disclose the formula, threshold, reason, probabilities, ordinary and great rewards, failure, small-probability real harm, and an option to decline. Await the player's roll under those exact terms. Never reroll by deleting result. Dice cannot change established truth or another person's consent.

A generated place needs a README, two meaningful objects, an actionable Chalk, and a return gate. A resident can be a nonportable note with a name, occupation, visible behaviour and limited knowledge, performed by the Writer; do not invent an unregistered character button. Existing README alone does not mean complete: inspect and repair missing files, never reroll the place on revisit. Text first, then generate_image ONCE for the exact scene. Attach only a returned, existing asset to bg; remove conflicting bgVideo. Image failure leaves the text playable, is reported honestly and is not retried automatically. The 1–2 minute segment is a design budget, not a latency promise.`;
