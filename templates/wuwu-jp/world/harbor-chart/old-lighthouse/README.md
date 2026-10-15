---
type: gate
name: 旧灯台・消えた灯
title: 旧灯台・消えた灯
bg: assets/scenes/old-lighthouse.webp
intent: 灯油を借りるのは「灯油を一份借りる」ボタンによって確実にworld/harbor-chart/old-lighthouse/lamp-oil.mdをplayer/lamp-oil.mdへ移すもので、作家は別に灯油を作らず、二份目を補給しない。日誌は消灯の時刻を証明できるだけだ。老モーが知らない第二の船を彼の記憶として捏造してはならない。
choice:
  options:
    - id: search
      label: 望遠鏡で旧隧道口を見る（ダイス）
    - id: action-1
      label: 灯台の日誌を読む
    - id: action-2
      label: 灯油を一份借りる
    - id: action-3
      label: 老モーにあの十二分のことを聞く
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/lighthouse.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/harbor-chart/old-lighthouse/lighthouse-logbook.md
  action-2:
    kind: take
    paths:
      - world/harbor-chart/old-lighthouse/lamp-oil.md
  action-3:
    kind: character
    character: old-mo
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: spot_hidden
    label: 望遠鏡で旧隧道口を見る（ダイス）
    title: 老モーの望遠鏡で旧隧道口を見る
    body: |-
      灯廊に立ち、老モーの真鍮の望遠鏡なら港の向こうの旧税関隧道口まで見通せる——霧がどいて、濡れた手すりで君の手が安定していればの話だが。

      この一振りで決まるのは、旧灯台の糸をその場で留められるかどうか、そして老モーの望遠鏡にも関わる。出目が良ければ証拠は直接鞄へ、悪ければ半本の糸だけ、最悪なら望遠鏡が割れる。留められなかった糸は失われない：カード上に「遠回り」が開き、老モーに日誌を一分ずつ照合してもらう。ただし潮位を一段余計に消費する。

      ダイス不要でいつでもできること：灯台の日誌を読む、老モーにあの十二分のことを聞く、灯油を一份借りる。これらは潮位を消費しないが、糸を留めてはくれない。

      1d100（目星 60）：技能値以下で成功、低いほど良い。
      96–100（5%）：濡れた灯廊の階段で足を滑らせ、望遠鏡も割れてしまい、老モーがそれを見て、彼はこのことを覚えている；潮位を一段余計に消費；灯油を持っていれば、慌てて燃やしてしまう。遠回りしかない。
      61–95（35%）：霧が隧道口を覆い、半本の糸（今夜の潮汐表）しか得られない。遠回りしかない。
      13–60（48%）：隧道口をはっきり見て、証拠「旧税関隧道と消灯の十二分」が鞄に入り、告発カードに✓がつく。
      1–12（12%）：同上、しかも素早く調べた：この一振りは潮位を消費しない。

      潮位：振るたびに一段減る（大成功を除く）；96–100に落ちればさらに一段減る；遠回りでさらに一段減る。このカードは一度しか振れない。
    roll_dice:
      type: 2d10
      desc: 老モーの望遠鏡で旧隧道口を見る
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
        harm: serious
        text: 灯廊の濡れた階段で足を踏み外し、望遠鏡が滑って石に当たって割れ、君自身も数段の階段を仰向けに転げ落ちた。老モーがそれを見た。この糸は留まらなかった；あの夜のことを再び聞く前に、まず謝り、それから遠回りで一緒に日誌を照合しなければならない。
        options:
          - id: long-way
            label: 遠回り：老モーに日誌を一分ずつ照合してもらう
            action:
              kind: read
              paths:
                - world/harbor-chart/old-lighthouse/05-long-way.md
          - id: back
            label: 地図に戻る
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: 霧が隧道口を覆った。君は老モーの机の上の今夜の潮汐表しか得られなかった——隧道がいつ使えるかはわかるが、消灯の十二分がちょうどそれに重なることは示せない。得たのは半本の糸で、留めるには遠回りが必要だ。
        options:
          - id: long-way
            label: 遠回り：老モーに日誌を一分ずつ照合してもらう
            action:
              kind: read
              paths:
                - world/harbor-chart/old-lighthouse/05-long-way.md
          - id: back
            label: 地図に戻る
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: 霧が薄くなった。干潮時に隧道口は水面から現れ、日誌の消灯の十二分はちょうどその時間帯だ。旧灯台の糸が留まった。
        options:
          - id: read-evidence
            label: この証拠を見る
            action:
              kind: read
              paths:
                - player/customs-tunnel.md
          - id: back
            label: 地図に戻る
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: 霧がどくと、隧道口ははっきり見える：水面から現れる時刻と消灯の十二分がぴったり重なる。旧灯台の糸が留まり、しかも素早く調べたので、潮位はほとんど動かなかった。
        options:
          - id: read-evidence
            label: この証拠を見る
            action:
              kind: read
              paths:
                - player/customs-tunnel.md
          - id: back
            label: 地図に戻る
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank >= 3
          run: evidence-tunnel
          on_error: continue
        - when: roll.rank <= 2
          run: miss-lighthouse
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
  - id: peek-logbook
    skill: stealth
    label: 老モーの隙を見て、彼の日誌をめくる
    title: 老モーの隙を見て、彼の日誌をめくる
    body: |-
      老モーの日誌は書き物机の上に広げられ、彼は背を向けて灯に油を注いでいる。

      今ならめくってよい——めくらずに直接聞いてもよい。めくるかどうかは潮位を消費しない；ただ彼に見られれば、その後の話は難しくなる。大成功（1–12）なら彼は一度も振り返らず、その一行を紙切れに書き写して持っていける。
    roll_dice:
      type: 2d10
      desc: 老モーが背を向けて油を注ぐ隙に、書き物机の日誌を開く
      expect: ">=11"
    on:
      roll_resolved:
        - run: peek-logbook
map:
  pins:
    lighthouse-logbook:
      - 0.25
      - 0.74
    lamp-oil:
      - 0.16
      - 0.66
    old-mo:
      - 0.62
      - 0.62
    player:
      - 0.45
      - 0.9
  plan:
    picture: assets/maps/old-lighthouse.webp
    pins:
      lighthouse-logbook:
        - 0.35
        - 0.48
      lamp-oil:
        - 0.3
        - 0.36
      old-mo:
        - 0.56
        - 0.53
      player:
        - 0.49
        - 0.75
---

灯台守の老モーは、あの夜、灯を十二分間消したと言う。なぜよりによってその時間だったのか？

日誌を読むのも、老モーに聞くのも、ダイスは不要だ。ここの糸を留めるには、老モーの望遠鏡で旧隧道口を見る必要がある——出目によって、隧道口をはっきり見られるか、潮汐表しか得られないか、望遠鏡を壊してしまうかが決まる。老モーが貸せる灯油は一份だけだ：海図上の決定的判定では霧の中の最も滑る足場に立つことになるから、持っているとずっと安定する。
