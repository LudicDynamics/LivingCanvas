---
type: gate
name: 検視室 · 事件はいつ起きた？
title: 検視室 · 事件はいつ起きた？
bg: assets/backgrounds/morgue.webp
intent: ここで名前を挙げた記録は、プレイヤーが調べてダイスを振った後に初めて現れる。それより前に見せたり語ったりしない。time-record.md
  と印刷所の受領票を比較する。時刻だけで特定人物の犯行を証明したとは言わない。
choice:
  options:
    - id: search
      label: ここを調べる（ダイス）
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/morgue.webm
choice_actions:
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: library_use
    label: ここを調べる（ダイス）
    title: 絵と事件の順番を解く
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
      desc: 絵と事件の順番を解く
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
        text: 核心だけでなく、次に確かめる手順まで見えた。納品は昨日十八時、事件は今朝六時。絵は事件より先だ。現場を見てから描いたという説明では順番が合わない。
          原本を示して質問すれば、推測と証言を分けて確かめられる。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record.md
            title: 事件の時刻 · 今朝六時
            body: |-
              三件目の事件は、今朝六時ごろです。

              印刷所にある絵の受け取り記録と比べましょう。絵のほうが先なら、誰かが絵に合わせて事件を起こした可能性があります。
          - path: world/london-map/morgue/investigation-great-success.md
            title: 核心を記した覚え書き
            body: 核心だけでなく、次に確かめる手順まで見えた。納品は昨日十八時、事件は今朝六時。絵は事件より先だ。現場を見てから描いたという説明では順番が合わない。
              原本を示して質問すれば、推測と証言を分けて確かめられる。
      - min: 13
        max: 60
        text: 観察がつながった。納品は昨日十八時、事件は今朝六時。絵は事件より先だ。現場を見てから描いたという説明では順番が合わない。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record.md
            title: 事件の時刻 · 今朝六時
            body: |-
              三件目の事件は、今朝六時ごろです。

              印刷所にある絵の受け取り記録と比べましょう。絵のほうが先なら、誰かが絵に合わせて事件を起こした可能性があります。
          - path: world/london-map/morgue/investigation-success.md
            title: 調査の覚え書き
            body: 観察がつながった。納品は昨日十八時、事件は今朝六時。絵は事件より先だ。現場を見てから描いたという説明では順番が合わない。
      - min: 61
        max: 95
        text: 台帳は訂正だらけだ。三件目が今朝だったことは分かるが、印刷所の記録と並べるべき時刻が読み取れない。調べるのに時間がかかりすぎた。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record-half.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record-half.md
            title: はっきりしない事件の時刻
            body: |-
              死体安置所の台帳には、三人目の被害者が「今朝早く」運ばれたとある。だが肝心の時刻は線で消され、書き直されている。

              まだ足りないもの：事件の正確な時刻。これがなければ、絵の納品時刻と比べようがない。
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 調べる物音が響き、気付かれずに調べる機会を失った。時刻を読む前に、番人が台帳を片付けてしまった。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record-half.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record-half.md
            title: はっきりしない事件の時刻
            body: |-
              死体安置所の台帳には、三人目の被害者が「今朝早く」運ばれたとある。だが肝心の時刻は線で消され、書き直されている。

              まだ足りないもの：事件の正確な時刻。これがなければ、絵の納品時刻と比べようがない。
            partial: true
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-picture
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/morgue.webp
    pins:
      time-record:
        - 0.83
        - 0.44
      player:
        - 0.26
        - 0.84
---

三件目の事件は、今朝六時ごろに起きました。

絵がそれより前に描かれていたなら、「事件を見てから描いた」とは言えません。印刷所の記録と比べましょう。
