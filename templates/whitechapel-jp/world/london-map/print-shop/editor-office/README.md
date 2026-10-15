---
type: gate
name: 編集室 · 原稿を渡した相手
title: 編集室 · 原稿を渡した相手
bg: assets/backgrounds/press.webp
intent: ここで名前を挙げた記録は、プレイヤーが調べてダイスを振った後に初めて現れる。それより前に見せたり語ったりしない。correction-log.md
  を根拠に、原稿流通の責任と犯罪への関与を分ける。患者の居場所は明かさない。
choice:
  options:
    - id: search
      label: ここを調べる（ダイス）
    - id: action-1
      label: 訂正稿を誰に回したか聞く
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/press.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: blackburn
search:
  - id: scene
    skill: library_use
    label: ここを調べる（ダイス）
    title: 訂正稿の行き先を追う
    body: |-
      ここを自分で調べることにした。手掛かりはまだ見つかっていない。ダイスを振った後に初めて出てくる。

      1d100：小さいほど良い結果。60以下で成功。
      1–12：大成功。手掛かりに加えて、核心の覚え書きが残る。
      13–60：成功。手掛かりと調査の覚え書きが見つかる。
      61–95：失敗。半分しか見えない。手に入るのは手掛かりそのものではなく、何が足りないかを書いた半端な手掛かりで、時間も余計にかかる。
      96–100：大失敗。半端な手掛かりだけが残り、時間を大きく失う。調べる物音に誰かが気付く。

      時計は正午へ進む。失敗は一目盛り、大失敗は二目盛りの時間を使う。見落とした手掛かりが事件から消えるわけではなく、ほかの場所が真相へ導くこともある。一か所につき調べられるのは一度だけで、振り直しはできない。ダイスが止まったら、作家が何が見つかったかを語る。
    roll_dice:
      type: 1d100
      desc: 訂正稿の行き先を追う
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
        text: 核心だけでなく、次に確かめる手順まで見えた。編集者は八時に受け取り、八時十五分にウェインへ回した。訂正住所は作者と編集者だけの秘密ではなかった。
          原本を示して質問すれば、推測と証言を分けて確かめられる。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log.md
            title: 住所を変えた原稿の行き先
            body: |-
              今朝八時：ブラックバーンがイーディスから原稿を受け取った。
              八時十五分：その原稿をウェインへ渡した。受け取りの名前もウェインです。

              新しい住所は、ウェインも読めました。画室で、実際に読んだか聞いてみましょう。受け取っただけで犯行が確定するわけではありません。
          - path: world/london-map/print-shop/editor-office/investigation-great-success.md
            title: 核心を記した覚え書き
            body: 核心だけでなく、次に確かめる手順まで見えた。編集者は八時に受け取り、八時十五分にウェインへ回した。訂正住所は作者と編集者だけの秘密ではなかった。
              原本を示して質問すれば、推測と証言を分けて確かめられる。
      - min: 13
        max: 60
        text: 観察がつながった。編集者は八時に受け取り、八時十五分にウェインへ回した。訂正住所は作者と編集者だけの秘密ではなかった。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log.md
            title: 住所を変えた原稿の行き先
            body: |-
              今朝八時：ブラックバーンがイーディスから原稿を受け取った。
              八時十五分：その原稿をウェインへ渡した。受け取りの名前もウェインです。

              新しい住所は、ウェインも読めました。画室で、実際に読んだか聞いてみましょう。受け取っただけで犯行が確定するわけではありません。
          - path: world/london-map/print-shop/editor-office/investigation-success.md
            title: 調査の覚え書き
            body: 観察がつながった。編集者は八時に受け取り、八時十五分にウェインへ回した。訂正住所は作者と編集者だけの秘密ではなかった。
      - min: 61
        max: 95
        text: ブラックバーンが机のそばを離れない。訂正稿が朝八時に届いたことは読めたが、次にどこへ行ったかは分からない。調べるのに時間がかかりすぎた。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log-half.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log-half.md
            title: 半分だけ読めた回覧記録
            body: |-
              ブラックバーンの回覧記録には、イーディスの訂正稿が朝八時に届いたとある。その次の行、原稿がどこへ行ったかは吸い取り紙の下で、めくらせてもらえなかった。

              まだ足りないもの：八時以降に原稿を受け取った人物と、その署名。
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 調べる物音が響き、気付かれずに調べる機会を失った。ブラックバーンは記録簿を閉じ、書類に触らないでくれと冷たく言った。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log-half.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log-half.md
            title: 半分だけ読めた回覧記録
            body: |-
              ブラックバーンの回覧記録には、イーディスの訂正稿が朝八時に届いたとある。その次の行、原稿がどこへ行ったかは吸い取り紙の下で、めくらせてもらえなかった。

              まだ足りないもの：八時以降に原稿を受け取った人物と、その署名。
            partial: true
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-address
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/editor-office.webp
    pins:
      correction-log:
        - 0.5
        - 0.42
      blackburn:
        - 0.73
        - 0.27
      player:
        - 0.27
        - 0.8
---

編集者のブラックバーンが原稿を管理しています。今朝、イーディスから住所を変えた原稿が届きました。

その原稿を、次に誰へ渡したのでしょう？ 机を調べるか、本人に聞いてみましょう。
