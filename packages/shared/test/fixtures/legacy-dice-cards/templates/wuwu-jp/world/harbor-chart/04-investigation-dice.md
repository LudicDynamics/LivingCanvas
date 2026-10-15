---
type: chalk
title: 港口の防波堤から霧の中の船を探す
roll_dice:
  type: 2d10
  desc: 港口の防波堤から霧の中の船を探す
  expect: ">=11"
choice:
  options:
    - id: back
      label: 今は振らずに地図へ戻る
choice_actions:
  back:
    kind: enter
    target: world/harbor-chart
dice_outcomes:
  - min: 2
    max: 4
    text: 濡れた石で足が滑り、手提げランプが揺れた。桟橋から夜番の声が飛ぶ。霧が閉じた。何も見えず、今夜はもう港口から探せない。
    options:
      - id: lay-out-clues
        label: 代わりに手掛かりを並べる
        action:
          kind: read
          paths:
            - world/harbor-chart/02-two-wakes.md
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/harbor-watch-notice.md
        title: 夜番の警告
        body: |-
          港の夜番が、防波堤の上のランプを見つけた。今夜はもう港口から探すことはできない。

          二隻目の船はまだ見つけられる。手元の手掛かりを並べ、老モーに灯台の明かりを借りよう。
  - min: 5
    max: 10
    text: 船はいない。けれど泡立った筋と、防波堤の石に残る新しい濡れ跡が、大きな何かがすぐそばを通り、岸沿いに旧税関のほうへ向かったことを告げている。
    options:
      - id: follow-tide-mark
        label: 潮の跡を歩いて追う
        action:
          kind: writer
          prompt: 実際の出目とこのカード world/harbor-chart/04-investigation-dice.md、落ちた物 world/harbor-chart/tide-mark-rubbing.md（プレイヤーが動かした場合は移動先）を読む。今回見つかったのは潮の跡だけで、船は見えていない。跡を追って旧税関側へ歩く短い場面 world/harbor-chart/tidal-approach/ を生成する：README、物二つ、行動付きの Chalk、戻る出口。ここでは二隻目の船も岸の小道も明かさない。画像は後で。本文が完成済みなら再生成しない。
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/tide-mark-rubbing.md
        title: 新しい潮の跡の拓本
        body: |-
          船は見えなかった。けれど泡立った筋と、防波堤の石の新しい跡が、大きな何かがすぐそばを通ったことを示している。

          跡は岸沿いに旧税関のほうを指している。歩いて追える。
  - min: 11
    max: 17
    text: ひと息のあいだ霧が薄れた。灯りのない黒い船が、深く沈んだまま、岸沿いの小道のほうへ向きを変えていく。
    options:
      - id: follow-the-ship
        label: 船を追って霧の先へ
        action:
          kind: writer
          prompt: 実際の出目とこのカード world/harbor-chart/04-investigation-dice.md、落ちた物 world/harbor-chart/second-ship-outline.md（プレイヤーが動かした場合は移動先）を読む。二隻目の船が見えた。その輪郭から最初の岸の小道 world/harbor-chart/beyond-the-fog/ を生成する：README、物二つ、行動付きの Chalk、戻る出口。この結果では紹介状を出さない。画像は後で。本文が完成済みなら再生成しない。
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/second-ship-outline.md
        title: 二隻目の船の輪郭
        body: |-
          一瞬、霧が薄れた。灯りのない黒い船が、深く沈んだまま、岸沿いの小道のほうへ向きを変えていた。

          二隻目の船は本当にいる。行き先は、その岸の小道だ。
  - min: 18
    max: 20
    text: 霧が薄れ、黒い船が姿を見せた。岸の小道では小さな灯りが二度、こちらへ瞬く。向こうにもあの船を見た人がいて、会ってくれるつもりらしい。
    options:
      - id: meet-the-lantern
        label: 船を追い、灯りの主に会う
        action:
          kind: writer
          prompt: 実際の出目とこのカード world/harbor-chart/04-investigation-dice.md、落ちた物 world/harbor-chart/shore-lantern.md（プレイヤーが動かした場合は移動先）を読む。二隻目の船と、手を貸してくれる人が見えた。成功と同じく world/harbor-chart/beyond-the-fog/ を生成し（README、物二つ、行動付きの Chalk、戻る出口）、灯りの主からの player/introduction-letter.md を、プレイヤーが持つ証拠だけに基づいて作る。画像は後で。本文が完成済みなら再生成しない。
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/shore-lantern.md
        title: 応えてくれた灯り
        body: |-
          黒い船が霧から姿を見せ、岸の小道で小さな灯りが二度瞬いた。

          岸の小道にも、あの船を見た人がいる。会ってくれるつもりらしい。
---

港口の防波堤に出て、霧の中に二隻目の船を探します。明かりはなく、足元は濡れた石です。

このダイスで決まるのは、どの道が開くかです。見えれば、霧の向こうの岸の小道が開きます。惜しければ、残るのは潮の跡だけで、歩いて追うことになります。足を滑らせれば港の夜番に見つかり、この近道は閉じます。残るのは遠回りの道、手掛かりを並べて灯台の明かりを借りることです。

ダイスなしでいつでもできること：集めた手掛かりを並べる（「別の船を探す」）、手掛かりを読み直す、ここの人に尋ねる。

2d10：十面ダイスを二つ振ります。合計11以上で成功です。
2–4（6%）：足を滑らせ、夜番に見つかります。何も見えず、今夜この近道は閉じます。夜番の警告が手元に残ります。
5–10（39%）：船は見えませんが、新しい潮の跡があります。岸沿いに歩いて追えます。
11–17（49%）：二隻目の船の輪郭が見え、霧の向こうの岸の小道が開きます。
18–20（6%）：船と、岸の小道で応える灯り。小道が開き、会ってくれる人がいます。

振れるのは一度だけです。見つけたものは物としてここに残り、持って行けます。次に進める道はそれで決まります。
