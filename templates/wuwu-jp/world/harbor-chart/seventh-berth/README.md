---
type: gate
name: 7番埠頭・船の傷
title: 7番埠頭・船の傷
bg: assets/scenes/seventh-berth.webp
intent: 水位の痕跡を調べた後、相手に実際の記録を読ませる。銀鳶は空箱を示しても、あの不明船の全貌を断定することはない。
choice:
  options:
    - id: search
      label: 交代に紛れて船に忍び込み船倉を探る（サイコロを振る）
    - id: action-1
      label: 船の傷の説明を読む
    - id: action-2
      label: 銀鳶に箱のことを尋ねる
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/dock.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/harbor-chart/seventh-berth/waterline-trace.md
  action-2:
    kind: character
    character: silver-kite
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: stealth
    label: 交代に紛れて船に忍び込み船倉を探る（サイコロを振る）
    title: 交代に紛れて無人船に忍び込み、空の船倉を開ける
    body: |-
      銀鳶が交代中で、舷梯は一分間誰も見ていない——あの無人船に忍び込み、船倉をこじ開けるには十分だ。

      この一振りが決めるのは：7番埠頭のこの糸をその場で留められるかどうか。出目がよければ証拠は直接かばんに入る。出目が悪ければ半本の糸しか得られない。出目がとても悪ければ銀鳶にその場で捕まる。留まらなかった糸は失われない：カードに「遠回り」が開き、銀鳶の面前で船倉を開けてもらうが、潮水を余分に一段消費するだけだ。

      サイコロを振らず、いつでもできること：擦り傷の記録を読み、銀鳶に箱のことを尋ねる。潮水は消費しないが、糸を留めてはくれない。

      1d100（隠密 60）：技能値以下で成功、低いほど良い。
      96–100（5%）：銀鳶に見つかり、舷梯で打ち身を負う。何も得られず、彼はこのことを覚えている。潮水を余分に一歩消費する。灯油を持っていれば、慌てて燃やしてしまう。遠回りするしかない。
      61–95（35%）：船倉を開ける間もなく、半本の糸（別の船の塗料一片）しか得られない。遠回りするしかない。
      13–60（48%）：船倉を開け、証拠「あの船は囮だ」がかばんに入り、告発カードに✓がつく。
      1–12（12%）：同上、しかも素早く調べた：この一振りは潮水を消費しない。

      潮位：振るたびに一段減る（大成功を除く）；96–100に落ちればさらに一段減る；遠回りでさらに一段減る。このカードは一度しか振れない。
    roll_dice:
      type: 2d10
      desc: 交代に紛れて無人船に忍び込み、空の船倉を開ける
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
        text: 舷梯の上に着いた途端、銀鳶の手があなたの襟を掴み、引きずり下ろし、肋骨を手すりに何度も打ちつけた。船倉のことは一言も言わず——舷梯をあなたに対して閉ざしただけだった。この糸は留まらなかった。船倉に何があるか知りたければ、遠回りして、直接彼を訪ねるしかない。
        options:
          - id: long-way
            label: 遠回り：銀鳶の面前で船倉を開けてもらう
            action:
              kind: read
              paths:
                - world/harbor-chart/seventh-berth/05-long-way.md
          - id: back
            label: 地図に戻る
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: 船倉を開ける間もなかった。あなたは満潮線より高い擦り傷から、別の船の黒い塗料を一片削り取っただけ——第二の船の存在は証明できるが、この船が囮だとは証明できない。得たのは半本の糸で、それを留めるには遠回りしなければならない。
        options:
          - id: long-way
            label: 遠回り：銀鳶の面前で船倉を開けてもらう
            action:
              kind: read
              paths:
                - world/harbor-chart/seventh-berth/05-long-way.md
          - id: back
            label: 地図に戻る
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: 艙蓋がこじ開けられた。中にはバラスト石と打ち付けられた空箱だけ。この船はわざと空にして放たれたのだ——7番埠頭の糸が留まった。
        options:
          - id: read-evidence
            label: この証拠を見る
            action:
              kind: read
              paths:
                - player/decoy-ship.md
          - id: back
            label: 地図に戻る
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: 艙蓋は一こじりで開き、銀鳶が戻る前に点検を終えた：バラスト石と打ち付けられた空箱。7番埠頭の糸が留まり、しかも素早く調べたので、潮水はほとんど動かなかった。
        options:
          - id: read-evidence
            label: この証拠を見る
            action:
              kind: read
              paths:
                - player/decoy-ship.md
          - id: back
            label: 地図に戻る
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank >= 3
          run: evidence-decoy
          on_error: continue
        - when: roll.rank <= 2
          run: miss-berth
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
    waterline-trace:
      - 0.22
      - 0.66
    silver-kite:
      - 0.68
      - 0.76
    player:
      - 0.5
      - 0.9
  plan:
    picture: assets/maps/seventh-berth.webp
    pins:
      waterline-trace:
        - 0.27
        - 0.3
      silver-kite:
        - 0.63
        - 0.63
      player:
        - 0.5
        - 0.88
---

騎士銀鳶が、誰もいない船を見張っている。船腹には傷が一道あり、その位置は水面よりずっと高い。

何が船にぶつかったのか？傷の記録を読み、銀鳶に空箱のことを尋ねるのは、サイコロを振らなくてよい。ここで糸を留めるには、交代に紛れて船に忍び込み船倉を探る必要がある——出目が、証拠を得るか、半本の糸か、銀鳶にその場で捕まるかを決める。
