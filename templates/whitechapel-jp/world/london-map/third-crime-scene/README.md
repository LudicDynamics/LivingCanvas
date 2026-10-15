---
type: gate
name: 第三現場 · 絵とそっくり
title: 第三現場 · 絵とそっくり
bg: assets/backgrounds/scene3.webp
intent: ここで名前を挙げた記録は、プレイヤーが調べてダイスを振った後に初めて現れる。それより前に見せたり語ったりしない。pigment-record.md
  を根拠に答える。群青だけで人を断定しない。絵が先か事件が先かは検視室の時刻記録、原稿を見られた人は印刷所へ案内する。
choice:
  options:
    - id: search
      label: ここを調べる（ダイス）
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/scene3.webm
choice_actions:
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: spot_hidden
    label: ここを調べる（ダイス）
    title: 構図の違和感を見抜く
    body: |-
      ここを自分で調べることにした。手掛かりはまだ見つかっていない。ダイスを振った後に初めて出てくる。

      1d100：小さいほど良い結果。60以下で成功。
      1–12：大成功。手掛かりに加えて、核心の覚え書きが残る。
      13–60：成功。手掛かりと調査の覚え書きが見つかる。
      61–95：失敗。半分しか見えない。手に入るのは手掛かりそのものではなく、何が足りないかを書いた半端な手掛かりで、時間も余計にかかる。
      96–100：大失敗。半端な手掛かりだけが残り、時間を大きく失う。急ぎすぎて怪我をするかもしれない。

      時計は正午へ進む。失敗は一目盛り、大失敗は二目盛りの時間を使う。見落とした手掛かりが事件から消えるわけではなく、ほかの場所が真相へ導くこともある。一か所につき調べられるのは一度だけで、振り直しはできない。ダイスが止まったら、作家が何が見つかったかを語る。
    roll_dice:
      type: 1d100
      desc: 構図の違和感を見抜く
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
        text: 核心だけでなく、次に確かめる手順まで見えた。椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。
          原本を示して質問すれば、推測と証言を分けて確かめられる。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record.md
            title: 現場に残った青い絵具
            body: |-
              手すりには、画筒の蓋と似た青い絵具が付いています。そばの跡から、誰かが右手をぶつけたようです。椅子と帽子も、小説の絵と同じ位置です。

              絵を知っている人が現場を並べた可能性があります。印刷所で絵を描いた人を調べ、右手にけががないか確かめましょう。
          - path: world/london-map/third-crime-scene/investigation-great-success.md
            title: 核心を記した覚え書き
            body: 核心だけでなく、次に確かめる手順まで見えた。椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。
              原本を示して質問すれば、推測と証言を分けて確かめられる。
      - min: 13
        max: 60
        text: 観察がつながった。椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record.md
            title: 現場に残った青い絵具
            body: |-
              手すりには、画筒の蓋と似た青い絵具が付いています。そばの跡から、誰かが右手をぶつけたようです。椅子と帽子も、小説の絵と同じ位置です。

              絵を知っている人が現場を並べた可能性があります。印刷所で絵を描いた人を調べ、右手にけががないか確かめましょう。
          - path: world/london-map/third-crime-scene/investigation-success.md
            title: 調査の覚え書き
            body: 観察がつながった。椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。
      - min: 61
        max: 95
        text: 霧と野次馬。手すりの青いしみと、整いすぎた椅子は目に入ったが、その青が何で、誰が残したのかは分からない。調べるのに時間がかかりすぎた。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record-half.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record-half.md
            title: 半分だけ見えた現場の青い跡
            body: |-
              手すりのどこかに青いしみがあり、椅子も妙に丁寧に置かれている。だが濡れた地面と人だかりで、その青が何なのか、ここで誰かが怪我をしたのかは分からなかった。

              まだ足りないもの：絵具の正体と、右手をぶつけた跡。これがなければ、現場は誰も指さない。
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 調べる物音が響き、気付かれずに調べる機会を失った。見えたのは青いしみだけ。手すりの外側を覗こうと身を乗り出したとき、濡れた鉄柵がぐらつき、あなたは石段を転げ落ちた。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record-half.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record-half.md
            title: 半分だけ見えた現場の青い跡
            body: |-
              手すりのどこかに青いしみがあり、椅子も妙に丁寧に置かれている。だが濡れた地面と人だかりで、その青が何なのか、ここで誰かが怪我をしたのかは分からなかった。

              まだ足りないもの：絵具の正体と、右手をぶつけた跡。これがなければ、現場は誰も指さない。
            partial: true
        harm: serious
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-hand
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/third-crime-scene.webp
    pins:
      pigment-record:
        - 0.3
        - 0.29
      player:
        - 0.5
        - 0.82
---

椅子も帽子も、小説の絵と同じ場所にあります。誰かが、わざと絵のとおりに並べたようです。手すりには青い絵具と、手をぶつけた跡があります。

まず現場を調べてみましょう。見つかる物はダイスの後に出てきます。絵と事件のどちらが先だったかは、検視室と印刷所で確かめられます。
