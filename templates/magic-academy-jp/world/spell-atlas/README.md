---
type: gate
name: 魔法の材料 · 何を作ろう？
title: 魔法の材料 · 何を作ろう？
intent: 自由入力で動詞・対象の物・望む結果・許容する代価を聞く。物の実在と所持を確認して組み合わせの提案を記録する。選択だけでは自動施法しない。
choice:
  options:
    - id: action-1
      label: 組み合わせを提案する
    - id: action-2
      label: 使える物を調べる
choice_actions:
  action-1:
    kind: writer
  action-2:
    kind: read
    paths:
      - world/spell-atlas/star-fragment.md
      - world/spell-atlas/small-hand-mirror.md
      - world/spell-atlas/reflection-fragment.md
bg: assets/scenes/academy-library.webp
map:
  plan:
    picture: assets/maps/spell-atlas.webp
    pins:
      star-fragment: [0.25, 0.35]
      small-hand-mirror: [0.4, 0.23]
      opening-fragment: [0.6, 0.25]
      reflection-fragment: [0.75, 0.36]
      librarian: [0.7, 0.57]
      player: [0.5, 0.85]
---

使えるのは、星の欠片、手鏡、そして「開く」「映す」という魔法の言葉です。まず材料の説明を読んでみましょう。

例えば「手鏡に星空を映したい」のような短い提案で大丈夫。できることと代わりに必要なことを聞いて、納得してから魔法を使います。相談しただけで、大切な物を失うことはありません。
