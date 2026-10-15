// Reviewed corrections for translations that failed path/language preservation.
export function reviewedTranslation(entry) {
  if (entry.id === '684142db566931779b704d79222c1fb04b41e1373158db8745cece316afa7766') return '本文と生成プロンプトは日本語。ファイル名、フォルダ名、人物 ID は英小文字の kebab-case に固定し、プロトコル名と既存素材のパスを保つ。行動に対して具体的な結果を一つ描き、プレイヤーの決断を代わりに作らない。取得を求められた時だけ実物を移動する。読むことは所持ではなく、提出は消費ではない。人物を持ち物として扱わない。';
  if (entry.locale !== 'en') return undefined;
  const rewardTitles = { '見落としと次の手掛かり': 'A setback and the next lead', '調査の覚え書き': 'Investigation notes', '核心を記した覚え書き': 'Breakthrough notes' };
  if (rewardTitles[entry.source]) return rewardTitles[entry.source];
  if (entry.source.startsWith('## 言語と知識\n')) return `## Language and knowledge
Narration, titles, choices and generation prompts are English. Filenames, directories and character IDs stay stable lowercase English kebab-case; never use a display name as a path. Examples: world/harbor-chart/beyond-the-fog/lighthouse-road/README.md, player/introduction-letter.md, characters/nanami/memory.md. Preserve README.md, SKILL.md, world.json, preset.json and existing asset paths. Give new Chalk a stable English path and English title and body. Characters know only what they witnessed or were told. Never turn secrets the player has not encountered into memories in an epilogue.`;
  if (entry.id === '2efb334d121a54987aeaafd1580b59eb133c3f23c158ccae4b49ac740e396d0e') return `
[Blackburn](characters/blackburn/README.md) always has me racing a deadline. When [Wayne](characters/wayne/README.md)'s illustrations arrive, I send them to the press. I don't want to pretend I understand [Edith](characters/edith/README.md)'s thoughts just because I've read her manuscript.
`;
  if (entry.id === 'efe6a64da665142727a33de88fc23eae317c82b015c02812cc30eb52401555a8') return `## Draft, confirm, send
Read the current scene README's intent with read. If player/fax-draft.md is missing, immediately offer one Chalk with "Enter the message to send" and "Ask for help drafting". A confirmation button's name and the original letter are not the fax message. Once the player supplies a message, save the draft and show its destination, date, full text and character count on one Chalk. Offer "Send this fax" and "Rewrite". Reading, checking or using an item alone does not send anything. Follow this world's skill for the complete procedure.
The draft is the player's text. Save requested help as a proposal and obtain approval. In player/fax-draft.md, record destination 1995-01-01T08:00, sending time 1995-01-01T20:00, the message and status.data.sent: false. Recount Unicode characters excluding spaces, aiming for no more than one hundred. Do not use the action's name as the message. The original letter and frog provide context; they are not keys to consume.
Send only after displaying the message and destination and receiving explicit consent to "Send this fax". If the text changes, ask again. If the draft is missing, stop searching and offer text entry or help on one Chalk. If a receipt already records sending this draft, show its result rather than sending again. Every new transmission requires fresh consent.`;
  if (entry.id === '377eba575fa0a9616cc0ccb245da934f80857aeadcaa44256d18c5b94dcdf5b4') return 'Open the world list at http://localhost:5173/, choose **The Moonlit Pact · English**, and create a new save. Before starting, configure the Writer and image provider in Connection settings.';
  return undefined;
}

export function reviewedDocument(family, locale, file) {
  if (family.base !== 'moonlit-contract') return undefined;
  if (file === 'README.md') return locale === 'en' ? `# The Moonlit Pact

An original knight's pact. A black-haired male traveler stands on the left, a silver-haired female knight on the right. The player chooses their own name and wish. This edition uses English.

- Opening: world/README.md, one world/opening.md Chalk and one object, world/blue-ribbon.md.
- One CG serves as cover and opening background. There is no separate portrait, NPC card, video or second introduction.
- BGM: platform theme emberglass, Mystical/fantasy loop by nicorico_120, CC0. Full credits: assets/audio/CREDITS.md in the repository.
- Choose to agree and leave, review the Writer input, then Send. The Writer updates the ribbon and creates world/moonlit-courtyard. The player opens its new door.
- Each new scene contains its README, one opening Chalk, one object and one background. A further location is generated only when the player explicitly asks to continue. No recursive generation.
- Use layer navigation, or ask the Writer to return to a known parent. Earlier scenes remain intact.

## Starting and limits

Open http://localhost:5173/, select **The Moonlit Pact · English**, and create a new save. Configure the Writer and image provider in Connection settings first.

Save-specific settings are not shipped in the template. If needed, enable scene initialization in the new save's settings. Ordinary choices prepare the Writer input; review it and press Send to request generation.

World growth is driven by the world skill and Chalk intent, not a background task or infinite pregeneration. If an image fails, keep completed text and explain how to request another attempt. Packaging checks do not prove a real Agent has generated a subsequent scene. See the internal gameplay document for the live test record.
` : `# 月下の誓い

オリジナルの騎士と約束を交わす導入。左に黒髪の男性旅人、右に銀髪の女性騎士。主人公の名前と願いはプレイヤーが決める。この版の本文は日本語。

- 導入：world/README.md、一枚の world/opening.md、唯一の物品 world/blue-ribbon.md。
- 一枚の CG を表紙と導入背景に使う。独立した立ち絵、NPC カード、動画、二つ目の導入は置かない。
- BGM：共通テーマ emberglass。Mystical/fantasy loop、nicorico_120、CC0。詳しい表記はリポジトリの assets/audio/CREDITS.md。
- 契約して出発する選択 → 作家欄の内容を確認して Send → 作家がリボンを更新し、world/moonlit-courtyard を生成 → プレイヤーが新しい門を開く。
- 次の場面は README、一枚の opening Chalk、一つの物品、一枚の背景だけ。さらに進むと明確に頼んだ時だけ次の階層を生成し、先読みの再帰生成はしない。
- 階層ナビゲーションで戻るか、既知の親へ戻りたいと作家に伝える。以前の場面は消さない。

## 始め方と範囲

http://localhost:5173/ の世界一覧で **月下の誓い · 日本語** を選び、新しいセーブを作る。接続設定で作家と画像生成のサービスを設定しておく。

セーブごとの設定はテンプレートに含めない。必要なら新しいセーブの設定で場面の初期化を有効にする。通常の選択は作家欄に入り、内容を確認して Send を押すと生成を依頼できる。

世界の成長は world skill と Chalk intent に従う動作であり、バックグラウンド処理や無限の事前生成ではない。画像が失敗しても完成した本文は残し、再試行の頼み方を伝える。テンプレートの検査だけで、実際の Agent が次の場面を生成したとは判断しない。実機の検証記録は内部の体験設計文書を参照する。
`;
  if (locale === 'ja' && file === 'assets/image-prompts.md') return `# 導入 CG の確定プロンプト

使用ツール：image_gen。選定済みの原画をそのまま使う。以下は日本語版の再制作指示であり、既存画像の生成履歴は source-manifest.json に保持する。

オリジナルの登場人物二人が、月明かりの下で自らの意思で約束を交わそうとする、横長 16:9 のアニメ調ビジュアルノベル CG。既存作品のキャラクターは使わない。

左：短い黒髪の成人男性の旅人。炭色のフード付きコート。斜め後ろから捉え、右を向いている。
右：成人女性の騎士ライラ。左右非対称の短い銀灰色の髪、琥珀色の瞳。暗い葡萄色のキルティング服に、角張った黒銅の肩鎧。落ち着いた生成り色のスカーフ。青いドレス、金髪、髪のお団子、緑の目、既存作品を連想させる紋章は使わない。

ライラは画面中央へ、鎧に包まれた手のひらを差し出す。旅人の手は少し離れた場所で止まり、まだ触れておらず、同意もしていない。

場所は海沿いの崖にある、廃れた円形の石造りの天文台。壊れた真鍮の天球儀、床に走る細い淡紫色の幾何学的な光。崩れたアーチの向こうには風に流れる雲と淡い三日月。品格があり、神秘的だが希望のある雰囲気。手描き感のある緻密な背景と、上品な二次元アニメの人物表現。

左右の釣り合いが取れた二人構図。手の形を正確に。文字、ロゴ、字幕は入れない。衣装と建築はオリジナル。画面下部には、別途表示する台詞のための暗く静かな余白を残す。
`;
  return undefined;
}
