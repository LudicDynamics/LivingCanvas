---
type: chalk
title: ヴェラの万力で留め具を開ける
roll_dice:
  type: 2d10
  desc: ヴェラの万力で留め具を開ける
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
    text: 万力の中でピンが折れた。新しい擦り傷は、折れたほうと一緒に失われた。紋章はまだ読めるが、もう跡で船と照らし合わせることはできない。できるのは、誰がこの部品を注文するかというヴェラの記憶だけだ。
    options:
      - id: tell-vera
        label: ヴェラに何が壊れたか話す
        action:
          kind: character
          character: vera
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/workshop/snapped-pin.md
        title: 折れた留め具のピン
        body: |-
          留め具を開ける途中でピンが折れた。新しい擦り傷は折れたほうにあり、もう失われた。

          領主家の紋章はまだ読める。この部品を船と結び付けるには、この紋章で舵の部品を注文するのは誰か、ヴェラに聞くしかない。
  - min: 5
    max: 10
    text: 留め具は開いたが、紋章の下の注文印は錆に覆われている。木炭で拓本を取った。領主家の紋章と、薄すぎて読めない印。
    options:
      - id: ask-vera
        label: この紋章で部品を注文するのは誰かヴェラに聞く
        action:
          kind: character
          character: vera
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/workshop/crest-rubbing.md
        title: 紋章と錆びた印の拓本
        body: |-
          木炭の拓本。領主家の紋章と、その下の錆びて読めない注文印。

          紋章はどの家かを示すが、どの船かは示さない。この紋章で舵の部品を注文するのが誰か、ヴェラが知っているかもしれない。
  - min: 11
    max: 17
    text: 錆がはがれ落ちた。紋章の下には、領主家の帳簿から出た注文印がある。港の船籍にない船への注文だ。
    options:
      - id: to-berth
        label: 七番埠頭の傷と比べる
        action:
          kind: enter
          target: world/harbor-chart/seventh-berth
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/workshop/order-stamp.md
        title: 留め具の内側の注文印
        body: |-
          紋章の下に、領主家の帳簿から出た注文番号。港の船籍にない船への注文だ。

          これで領主が犯人だとは言えない。言えるのは、領主家が誰も登録していない船に金を払ったということだ。
  - min: 18
    max: 20
    text: 注文印がきれいに現れ、新しい擦り傷の高さは七番埠頭の無人船の傷とぴたりと同じだった。この留め具は、囮の船に押し付けられたあの船に付いていたのだ。
    options:
      - id: to-lighthouse
        label: その船がいつ通れたか調べる
        action:
          kind: enter
          target: world/harbor-chart/old-lighthouse
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/harbor-chart
    rewards:
      - path: world/harbor-chart/workshop/matched-clasp.md
        title: 注文印と高さの合う擦り傷
        body: |-
          領主家の帳簿から出た、船籍にない船への注文番号。そして七番埠頭の傷と同じ高さの新しい擦り傷。

          登録のないその船こそ、囮の船に押し付けられた船だ。それが人目につかずに通れたのはいつか。灯台で確かめよう。
---

留め具はまだ一つにつながっています。万力で開ければ、紋章の下に隠れた注文印が見えるかもしれません。ピンが折れて、新しい擦り傷ごと失われるかもしれません。

このダイスで決まるのは、留め具そのものと、それがまだ何を証明できるかです。良い目なら注文印が読めます。悪い目なら紋章の拓本だけ。ひどい目なら部品が壊れ、船と結び付けられるのはヴェラの記憶だけになります。

ダイスなしでいつでもできること：部品の説明を読む、ヴェラに持ち主を尋ねる。

2d10：十面ダイスを二つ振ります。合計11以上で成功です。
2–4（6%）：ピンが折れ、新しい擦り傷が失われます。折れたピンが残るので、ヴェラに尋ねてください。
5–10（39%）：錆で注文印が読めません。紋章の拓本が残ります。誰がこれを注文するか、ヴェラが知っているかもしれません。
11–17（49%）：注文印がはっきり読めます。領主家の帳簿から、港の船籍にない船への注文です。
18–20（6%）：注文印に加え、新しい擦り傷の高さが七番埠頭の傷とぴたりと合います。

振れるのは一度だけです。見つけたものは物としてここに残り、持って行けます。
