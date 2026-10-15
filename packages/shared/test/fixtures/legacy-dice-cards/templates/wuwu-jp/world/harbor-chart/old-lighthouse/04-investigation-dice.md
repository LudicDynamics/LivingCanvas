---
type: chalk
title: 老モーの望遠鏡でトンネルの出口を見る
roll_dice:
  type: 2d10
  desc: 老モーの望遠鏡でトンネルの出口を見る
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
    text: 望遠鏡が濡れた手すりで滑り、石に当たって割れた。老モーが見ていた。あの夜の話をもう一度する前に、彼はまず謝ってほしいだろう。トンネルの出口も、別のやり方で確かめるしかない。
    options:
      - id: apologize
        label: 老モーに謝る
        action:
          kind: character
          character: old-mo
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/old-lighthouse/cracked-spyglass.md
        title: 老モーの割れた望遠鏡
        body: |-
          望遠鏡が回廊の手すりから滑り落ち、レンズが割れた。老モーはその瞬間を見ていた。

          あの夜の話をもう一度する前に、彼は謝ってほしいはずだ。トンネルの出口はまだ確かめなければならない。今度は日誌か、歩いて。
  - min: 5
    max: 10
    text: 霧がトンネルの出口を隠している。けれど回廊の机には、老モーの今夜の潮見表が広げてあった。出口がいつ水の上に出るかが書いてある。
    options:
      - id: read-log
        label: 灯台日誌と並べて見る
        action:
          kind: read
          paths:
            - world/harbor-chart/old-lighthouse/lighthouse-logbook.md
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/old-lighthouse/tide-table.md
        title: 今夜の潮見表
        body: |-
          老モーの今夜の潮見表。旧税関トンネルの出口がいつ水の上に出るかが書いてある。

          船がトンネルを使えた時間は分かるが、実際に使ったかどうかは分からない。灯台日誌の十二分間と並べてみよう。
  - min: 11
    max: 17
    text: 霧が薄れた。引き潮で出口の泥がむき出しになり、トンネルから水際まで新しい竜骨の跡が続いている。最近、船がそこから出たのだ。
    options:
      - id: read-log
        label: 日誌の十二分間と照らし合わせる
        action:
          kind: read
          paths:
            - world/harbor-chart/old-lighthouse/lighthouse-logbook.md
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/old-lighthouse/tunnel-mouth-sketch.md
        title: トンネル出口の写生
        body: |-
          引き潮のとき、旧税関トンネルの出口は水から出る。そこから水際まで、新しい竜骨の跡が続いている。

          最近、船がこのトンネルを使った。人目につかずに出られたのがいつかは、灯台日誌に書いてある。
  - min: 18
    max: 20
    text: 出口には跡が二本あった。浅い一本と、荷を満載した船が刻んだ深い一本。重い何かがトンネルから運び出された。その船は、まだ霧のどこかにいるかもしれない。
    options:
      - id: search-fog
        label: 霧の中に満載の船を探す
        action:
          kind: read
          paths:
            - world/harbor-chart/04-investigation-dice.md
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/old-lighthouse/two-keel-grooves.md
        title: トンネル出口の二本の竜骨跡
        body: |-
          旧税関トンネルの出口の泥に、新しい跡が二本。浅い一本と、荷を満載した船が刻んだ深い一本。

          重い何かがトンネルから運び出された。その船は、まだ港の外の霧の中にいるかもしれない。
---

回廊からなら、老モーの真鍮の望遠鏡で港の向こうの旧税関トンネルの出口まで見えます。霧が晴れて、濡れた手すりの上で手が震えなければ、ですが。

このダイスで決まるのは、トンネルの出口で何が見えるか、そして老モーの望遠鏡の行方です。良い目なら、トンネルを船が使ったかどうかが分かります。悪い目なら、今夜の潮見表だけ。ひどい目なら望遠鏡が割れ、老モーはまず謝ってほしいと思うでしょう。

ダイスなしでいつでもできること：灯台日誌を読む、老モーに油を借りる相談をする。

2d10：十面ダイスを二つ振ります。合計11以上で成功です。
2–4（6%）：望遠鏡が割れ、老モーに見られます。何も見えません。続けて尋ねる前に謝りましょう。
5–10（39%）：霧が出口を隠します。今夜の潮見表が残ります。トンネルがいつ使えたかは分かっても、使われたかどうかは分かりません。
11–17（49%）：トンネルの出口に新しい竜骨の跡。最近、船がそこから出ています。
18–20（6%）：跡は二本。一本は荷を満載した船のもの。その船はまだ霧の中かもしれません。

振れるのは一度だけです。見つけたものは物としてここに残り、持って行けます。
