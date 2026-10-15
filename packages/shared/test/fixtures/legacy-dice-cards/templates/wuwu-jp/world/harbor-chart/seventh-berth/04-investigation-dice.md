---
type: chalk
title: 無人船に忍び込み、空の船倉を開ける
roll_dice:
  type: 2d10
  desc: 無人船に忍び込み、空の船倉を開ける
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
    text: 舷梯を上りきったところで、銀鳶の手があなたの襟をつかんだ。船倉のことは一言も言わない。ただ、この船にはもう近づくなと。何を積んでいたか知りたければ、彼と向き合うしかない。
    options:
      - id: face-silver-kite
        label: 銀鳶と向き合う
        action:
          kind: character
          character: silver-kite
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/seventh-berth/gangway-warning.md
        title: 銀鳶の警告
        body: |-
          無人船に忍び込むところを銀鳶に見られた。舷梯はもうあなたには開かない。

          船倉のことを話してもらうには、正面から彼を訪ねるしかない。傷の記録を見せ、なぜ船に上がったのかを話そう。
  - min: 5
    max: 10
    text: 船倉を開ける時間はない。満潮線より高い傷から、この船のものではないタールのような黒い塗料を一片はがし取った。別の船体が押し付けられたのだ。けれど、この一片では誰の船かまでは言えない。
    options:
      - id: to-workshop
        label: 塗料を工房で照らし合わせる
        action:
          kind: enter
          target: world/harbor-chart/workshop
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/seventh-berth/hull-paint-flake.md
        title: 別の船の塗料片
        body: |-
          満潮線より上の傷からはがした、タール色の黒い塗料。無人船の船体とは合わない。別の船が押し付けられた跡だ。

          二隻目がいた証拠にはなるが、誰の船かは分からない。工房の舵の部品が、もっと語ってくれるかもしれない。
  - min: 11
    max: 17
    text: 蓋が開いた。中には重しの石と、釘で閉じた空箱だけ。石を積んで儲けに出る船はない。この船はわざと空で出されたのだ。皆の目を七番埠頭へ向けるために。
    options:
      - id: show-silver-kite
        label: 見つけたものを銀鳶に見せる
        action:
          kind: character
          character: silver-kite
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/seventh-berth/ballast-stone.md
        title: 空の船倉の重し石
        body: |-
          船倉には重しの石と、釘で閉じた空箱しかなかった。

          この船はわざと空で出された。皆の目を七番埠頭へ集め、その間に別の何かを別の場所で動かすための囮だ。
  - min: 18
    max: 20
    text: 蓋が開いた。ランプを向けると、重しの石に刻印がある。旧税関の置き場の印だ。囮の船は、旧税関トンネルの出口で荷を積まれていた。
    options:
      - id: to-lighthouse
        label: トンネルがいつ使えたか灯台で聞く
        action:
          kind: enter
          target: world/harbor-chart/old-lighthouse
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/seventh-berth/customs-stamped-ballast.md
        title: 旧税関の刻印がある重し石
        body: |-
          空の船倉にあった重しの石に、旧税関の置き場の刻印がある。この船はわざと空で出され、しかも旧トンネルの出口の置き場で積み込まれていた。

          囮の船とトンネルは一つの計画だ。トンネルがいつ使えたかは、灯台の日誌に書いてある。
---

銀鳶が見張りを交代しています。一分ほど、舷梯に誰もいません。無人船に忍び込んで船倉を開けるには十分です。

このダイスで決まるのは、船から何を持ち出せるかです。良い目なら、この船に本当は何が積まれていたかが分かります。悪い目なら、船体から削り取ったかけら一つだけ。ひどい目なら銀鳶に捕まり、船への立ち入りを禁じられます。

ダイスなしでいつでもできること：傷の記録を読む、銀鳶に箱のことを尋ねる。

2d10：十面ダイスを二つ振ります。合計11以上で成功です。
2–4（6%）：銀鳶に捕まります。持ち帰るのは手掛かりではなく彼の警告です。船倉のことは、彼に直接向き合うしかありません。
5–10（39%）：船倉を開ける時間はありません。傷から別の船の塗料を一片だけ。二隻目がいた証拠にはなりますが、誰の船かは分かりません。
11–17（49%）：船倉には重しの石と空箱だけ。重しの石が、この船がわざと空で出されたことを示します。
18–20（6%）：重しの石に旧税関の置き場の刻印。囮の船は、旧トンネルの出口で荷を積まれていました。

振れるのは一度だけです。見つけたものは物としてここに残り、持って行けます。
