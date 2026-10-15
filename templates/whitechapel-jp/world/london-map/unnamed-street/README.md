---
type: gate
name: 名もない通り · 地図にない住所
title: 名もない通り · 地図にない住所
bg: assets/backgrounds/fourth.webp
intent: ここで名前を挙げた記録は、プレイヤーが調べてダイスを振った後に初めて現れる。それより前に見せたり語ったりしない。revision-scrap.md
  は地図の照合結果。meeting-options.md は相談用の既知の手段。まだ誘いを出したことにしない。合意した計画だけを実行する。
choice:
  options:
    - id: search
      label: ここを調べる（ダイス）
    - id: action-2
      label: 安全に相手を呼ぶ方法をワトソンへ相談する
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/fourth.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-2:
    kind: character
    character: watson
search:
  - id: scene
    skill: stealth
    label: ここを調べる（ダイス）
    title: 待ち伏せできる場所を選ぶ
    body: |-
      ここを自分で調べることにした。手掛かりはまだ見つかっていない。ダイスを振った後に初めて出てくる。

      1d100：小さいほど良い結果。60以下で成功。
      1–12：大成功。手掛かりに加えて、皆が見落としたものをもう一つ見つける。
      13–60：成功。手掛かりと調査の覚え書きが見つかる。
      61–95：失敗。半分しか見えない。手に入るのは手掛かりそのものではなく、何が足りないかを書いた半端な手掛かりで、時間も余計にかかる。
      96–100：大失敗。半端な手掛かりだけが残り、時間を大きく失う。急ぎすぎて怪我をするかもしれない。

      時計は正午へ進む。失敗は一目盛り、大失敗は二目盛りの時間を使う。見落とした手掛かりが事件から消えるわけではなく、ほかの場所が真相へ導くこともある。一か所につき調べられるのは一度だけで、振り直しはできない。ダイスが止まったら、作家が何が見つかったかを語る。
    roll_dice:
      type: 1d100
      desc: 待ち伏せできる場所を選ぶ
      expect: <=60
    choice:
      options:
        - id: back
          label: 今は振らずに地図へ戻る
    choice_actions:
      back:
        kind: enter
        target: world/london-map
    dice_outcomes:
      - min: 1
        max: 12
        text: 核心だけでなく、次に確かめる手順まで見えた。架空の通りには行けない。実在する中庭を使い、編集者に住所確認の仲介を頼める。イーディス本人を囮にする必要はない。
          原本を示して質問すれば、推測と証言を分けて確かめられる。角の地図売りの老人が、今朝道を尋ねてきた人物を覚えていた。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap.md
                - world/london-map/unnamed-street/meeting-options.md
                - world/london-map/unnamed-street/asked-the-way.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap.md
            title: 新しい住所は実在しない
            body: |-
              新しい住所は、市街図にも住所録にもありません。ここに行って待つ作戦は使えません。

              代わりに、印刷所の中庭で住所を確かめる面会を頼めます。誰を呼び、何を質問するかをワトソンと決めましょう。
          - path: world/london-map/unnamed-street/meeting-options.md
            title: 中庭で確かめる作戦
            body: |-
              編集者に「住所の確認をしたい」と伝え、気になる相手を中庭へ呼んでもらう案があります。ワトソンとは合図と帰り道を決められます。イーディスは221Bに残し、原稿の控えだけを使えます。

              まだ誰も呼んでいません。あなたがこの案を試すと決めたら、相手の返事を確かめて進めます。
            portable: false
          - path: world/london-map/unnamed-street/asked-the-way.md
            title: 道を尋ねた男
            body: |-
              角の地図売りの老人によれば、今朝九時ごろ、袖口に青い汚れのある若い男がこの通りを尋ねてきた。三度も訊き、右手はずっと懐に入れたままだったという。

              「ロンドンにそんな通りはないと言ったら、真っ青になってたよ」

              8時15分以降、イーディスの書き換えた住所を読んだのは、一人しかいない。
      - min: 13
        max: 60
        text: 観察がつながった。架空の通りには行けない。実在する中庭を使い、編集者に住所確認の仲介を頼める。イーディス本人を囮にする必要はない。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap.md
                - world/london-map/unnamed-street/meeting-options.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap.md
            title: 新しい住所は実在しない
            body: |-
              新しい住所は、市街図にも住所録にもありません。ここに行って待つ作戦は使えません。

              代わりに、印刷所の中庭で住所を確かめる面会を頼めます。誰を呼び、何を質問するかをワトソンと決めましょう。
          - path: world/london-map/unnamed-street/meeting-options.md
            title: 中庭で確かめる作戦
            body: |-
              編集者に「住所の確認をしたい」と伝え、気になる相手を中庭へ呼んでもらう案があります。ワトソンとは合図と帰り道を決められます。イーディスは221Bに残し、原稿の控えだけを使えます。

              まだ誰も呼んでいません。あなたがこの案を試すと決めたら、相手の返事を確かめて進めます。
            portable: false
          - path: world/london-map/unnamed-street/investigation-success.md
            title: 調査の覚え書き
            body: 観察がつながった。架空の通りには行けない。実在する中庭を使い、編集者に住所確認の仲介を頼める。イーディス本人を囮にする必要はない。
      - min: 61
        max: 95
        text: あたりを二度歩いても新しい通りは見つからない。だが確かめるための市街図にも住所録にも手が届かなかった。調べるのに時間がかかりすぎた。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap-half.md
                - world/london-map/unnamed-street/meeting-options.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap-half.md
            title: まだ見つからない新しい通り
            body: |-
              新しい住所のあたりを歩いてみたが、その通りは見つからなかった。ただ、市街図や住所録を確かめる時間はなかった。

              まだ足りないもの：その通りがそもそも存在しないという裏付けと、面会を本当に設けられる場所。
            partial: true
          - path: world/london-map/unnamed-street/meeting-options.md
            title: 中庭で確かめる作戦
            body: |-
              編集者に「住所の確認をしたい」と伝え、気になる相手を中庭へ呼んでもらう案があります。ワトソンとは合図と帰り道を決められます。イーディスは221Bに残し、原稿の控えだけを使えます。

              まだ誰も呼んでいません。あなたがこの案を試すと決めたら、相手の返事を確かめて進めます。
            portable: false
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 調べる物音が響き、気付かれずに調べる機会を失った。分かったのは、通りが見つからなかったことだけ。路地から石炭運びの馬車が飛び出してきて、慌てて避けたあなたは壁にぶつかった。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap-half.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap-half.md
            title: まだ見つからない新しい通り
            body: |-
              新しい住所のあたりを歩いてみたが、その通りは見つからなかった。ただ、市街図や住所録を確かめる時間はなかった。

              まだ足りないもの：その通りがそもそも存在しないという裏付けと、面会を本当に設けられる場所。
            partial: true
        harm: light
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-address
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/unnamed-street.webp
    pins:
      revision-scrap:
        - 0.34
        - 0.4
      meeting-options:
        - 0.66
        - 0.42
      player:
        - 0.5
        - 0.82
---

小説の新しい住所は、実在しません。そこへ行って待つことはできません。今いるのは、実際に会って話せる印刷所の中庭です。

編集者に頼み、住所の確認を理由に、気になる相手をここへ呼ぶ案があります。ワトソンに相談して、誰を呼ぶか、何を確かめるか決めましょう。イーディスを危険な場所へ連れ出す必要はありません。
