---
type: readme
name: 港務所・調査開始
title: 港務所・調査開始
bg: assets/scenes/intro.webp
intent: 承諾するなら、world/commission-letter.md と world/investigator-badge.md の実物をそれぞれ同名の move で player/ へ移す。すでにどちらかを持っているなら、欠けている方だけを移す。実際の所持を確認したうえで、港の地図へ案内する。
choice:
  options:
    - id: action-1
      label: 依頼書と徽章を受け取る
    - id: action-2
      label: 依頼条件を読む
bgVideo: assets/motion/seedance/backgrounds/intro.webm
choice_actions:
  action-1:
    kind: take
    paths:
      - world/commission-letter.md
      - world/investigator-badge.md
  action-2:
    kind: read
    paths:
      - world/commission-letter.md
map:
  pins:
    harbor-chart:
      - 0.88
      - 0.4
    commission-letter:
      - 0.575
      - 0.83
    investigator-badge:
      - 0.4
      - 0.82
    vera:
      - 0.6
      - 0.58
    player:
      - 0.16
      - 0.9
  plan:
    picture: assets/maps/harbor-office.webp
    pins:
      harbor-chart:
        - 0.82
        - 0.36
      commission-letter:
        - 0.46
        - 0.48
      investigator-badge:
        - 0.53
        - 0.47
      vera:
        - 0.65
        - 0.3
      player:
        - 0.3
        - 0.83
---

港務所の中は冷たい鉄と灯油の匂い。一隻の無人船、一人の失踪、同じ夜に消えた灯台——この三つが同じことなのか、誰かがあなたに確かめてほしいと頼んでいる。

ヴェラはもうここにいて、依頼書と徽章の置かれた机に寄りかかっている。あなたを呼び寄せる手紙を書いたのは彼女で、ずいぶん長く待った。待ちすぎて、話したいことがたくさん溜まっている。

徽章は港を歩き回るための許可証だ。受け取れば、彼女が海図を見せてくれる。

壁の潮位牌には残りが何歩か書いてある。潮がひとたび戻れば、霧に隠れたあの船は出て行ってしまう。それまでに、糸を全部留めよう。
