---
type: gate
name: 工房・船から外れた部品
title: 工房・船から外れた部品
bg: assets/scenes/workshop.webp
choice:
  options:
    - id: search
      label: 万力で留め金を外す（サイコロを振る）
    - id: action-1
      label: 船の部品を調べる
    - id: action-2
      label: ヴェラに持ち主を尋ねる
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/workshop.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/harbor-chart/workshop/crest-clasp.md
  action-2:
    kind: character
    character: vera
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: mechanical_repair
    label: 万力で留め金を外す（サイコロを振る）
    title: ヴェラの万力で留め金を外す
    body: |-
      留め金はまだ完全だ。ヴェラの万力に挟んで外せば、紋章の下に隠れた注文印が見えるかもしれない——留めピンが折れれば、あの新しい擦り傷ごと壊してしまうかもしれない。

      この一振りが決めるのは：工房のこの糸をその場で留められるかどうかで、留め金そのものにも関わる。出目がよければ証拠は直接かばんに入る。出目が悪ければ半本の糸しか得られない。出目がとても悪ければ部品は壊れ、ヴェラはとても悲しむ。留まらなかった糸は失われない：カードに「遠回り」が開き、ヴェラに注文帳を調べてもらうが、潮水を余分に一段消費するだけだ。

      サイコロを振らず、いつでもできること：部品の説明を読み、ヴェラに持ち主を尋ねる。潮水は消費しないが、糸を留めてはくれない。

      1d100（機械修理 60）：技能値以下で成功、低いほど良い。
      96–100（5%）：留めピンが弾け折れ、あなたの手を切り、ヴェラが見ていて、彼女はこのことを覚えている。潮水を余分に一歩消費する。灯油を持っていれば、慌てて燃やしてしまう。遠回りするしかない。
      61–95（35%）：錆が注文印を覆い、半本の糸（紋章の拓本）しか得られない。遠回りするしかない。
      13–60（48%）：注文印を読み取り、証拠「領主家の帳簿の一頁」がかばんに入り、告発カードに✓がつく。
      1–12（12%）：同上、しかも素早く調べた：この一振りは潮水を消費しない。

      潮位：振るたびに一段減る（大成功を除く）；96–100に落ちればさらに一段減る；遠回りでさらに一段減る。このカードは一度しか振れない。
    roll_dice:
      type: 2d10
      desc: ヴェラの万力で留め金を外す
      expect: ">=11"
    choice:
      options:
        - id: back
          label: まずダイスを振らず、地図に戻る
    choice_actions:
      back:
        kind: enter
        target: world/harbor-chart
    dice_outcomes:
      - min: 2
        max: 4
        harm: light
        text: 留めピンが万力の中で弾け折れ、飛んだ一截があなたの手を切り、あの新しい擦り傷も折れた一截と一緒に失われた。ヴェラは折れた断面をじっと見て何も言わなかった。この糸は留まらなかった。部品はもう語らなくなったので、遠回りして、ヴェラに注文帳を調べてもらうしかない。
        options:
          - id: long-way
            label: 遠回り：ヴェラに注文帳を調べてもらう
            action:
              kind: read
              paths:
                - world/harbor-chart/workshop/05-long-way.md
          - id: back
            label: 地図に戻る
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: 留め金は開いたが、注文印は錆に覆われていた。あなたは領主家の紋章だけを拓本に取った——どの家かはわかるが、どの船かはわからない。得たのは半本の糸で、それを留めるには遠回りしなければならない。
        options:
          - id: long-way
            label: 遠回り：ヴェラに注文帳を調べてもらう
            action:
              kind: read
              paths:
                - world/harbor-chart/workshop/05-long-way.md
          - id: back
            label: 地図に戻る
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: 錆が一枚ずつ剥がれ落ち、紋章の下から注文印がはっきりと現れた。領主家の帳簿に記され、港の船名簿にない船に発注されていた。工房の糸が留められた。
        options:
          - id: read-evidence
            label: この証拠を見る
            action:
              kind: read
              paths:
                - player/ledger-page.md
          - id: back
            label: 地図に戻る
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: 万力を緩めると、注文印が現れ、あの新しい擦り傷の高さまで7番埠頭の擦り傷と一致した。工房の糸が留められ、しかも素早く調べたので、潮はほとんど動かなかった。
        options:
          - id: read-evidence
            label: この証拠を見る
            action:
              kind: read
              paths:
                - player/ledger-page.md
          - id: back
            label: 地図に戻る
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank >= 3
          run: evidence-ledger
          on_error: continue
        - when: roll.rank <= 2
          run: miss-workshop
          on_error: continue
        - when: roll.rank == 1 && has("player/lamp-oil.md")
          run: burn-lamp-oil
          on_error: continue
        - when: roll.rank <= 3
          run: tide-step
          on_error: continue
        - when: roll.rank == 1
          run: tide-surge
          on_error: continue
map:
  pins:
    crest-clasp:
      - 0.47
      - 0.52
    player:
      - 0.42
      - 0.88
  plan:
    picture: assets/maps/workshop.webp
    pins:
      crest-clasp:
        - 0.5
        - 0.39
      player:
        - 0.46
        - 0.72
---

船の舵から外れた部品が、灯りの下の作業台に置かれている。ヴェラがそこに置いたものだ。部品には領主家の紋章がある。

それがどの船のものかが手がかりだ。部品の説明を読み、ヴェラに持ち主を尋ねるのは、サイコロを振らなくてよい。ここで糸を留めるには、万力で留め金を外す必要がある——出目が、注文印を読み取るか、紋章だけを拓本に取るか、留めピンを折るかを決める。
