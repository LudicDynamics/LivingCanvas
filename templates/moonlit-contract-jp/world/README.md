---
type: readme
name: 月下の召喚
title: 月下の召喚
bg: assets/backgrounds/opening.webp
intent: "この世界の行動では必ず skills/moonlit-contract-play/SKILL.md、現在の README、行動元の Chalk、青いリボンの実在するファイルを読む。開始時点では契約は未成立。明確な同意を得たときだけ world/moonlit-courtyard を一層生成する。質問や拒否では生成しない。既存の内容を保ち、次の場所はプレイヤーの明示した一歩ごとに生成する。結末はエンジンだけが下ろす（world.json の triggers）。ライラに残ってほしいと頼む、彼女を解き放つ、退ける、の三つ。作家は本文で結末を宣言しない。"
map:
  plan:
    picture: assets/maps/seaside-observatory.webp
    pins:
      moonlit-courtyard: [0.49, 0.12]
      blue-ribbon: [0.43, 0.53]
      lyra: [0.62, 0.46]
      player: [0.33, 0.84]
---

名もない街の夜。海辺の古い天文台の床に、石床に刻まれた淡紫の残光が揺れている。ライラがあなたの返事を待っている。

場内の読み物は opening.md 一枚、触れられる物は契約の証となる青いリボン一つ。扉の先はまだ描かれていない。人物と約束は作家が演じる。プレイヤーの名前、願い、同意は勝手に決めない。

最初の行き先は world/moonlit-courtyard。契約に同意し、外へ進む意思が示されたら、その子フォルダに README.md、opening.md、item.md と一枚の背景画像を作る。自動で先々を生成しない。帰り道は親の map。
