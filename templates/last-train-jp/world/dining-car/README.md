---
type: gate
name: 4号車・食堂車
bg: assets/scenes/dining-car.webp
title: 4号車・食堂車
intent: 第二幕の筋の一つ（食堂車の謎：4号卓の二杯のお茶は誰のものか、5号車の鍵はどこへ行ったのか）。料理人の賀じいは居眠りをしている。NPCカードlao-he.md（彼をクリックして「会話」）：彼は11時過ぎに4号卓に老紳士と若い娘がいたこと、娘が老紳士に黄ばんだ紙を見せたことを覚えている。停車後は眠ってしまい、何も見ていない。5号車の鍵は湯沸かし器のそばの石炭入れに隠されており、サイコロカードでのみ見つけられる。捜索がうまくいかなかった（61–100）ときは遠回りカード05-long-way.mdが開く（command/miss-dining.yaml）。選ぶと時間を一歩余計に消費し、鍵が持ち物に入る（command/long-way-dining.yaml）。
choice:
  options:
    - id: take-bill
      label: 4号卓のレシートを取る
    - id: read-teacups
      label: 4号卓の二つの茶碗を見る
      once: true
    - id: search
      label: サイコロで食堂車を捜索する
    - id: talk-laohe
      label: 賀じいと話す
    - id: ask-cups
      label: お茶が二杯……もう一杯は誰の？
      to: companion
      say: お茶が二杯……もう一杯は誰が飲んだの？
  allow_free: true
choice_actions:
  take-bill:
    kind: take
    paths:
      - world/dining-car/tea-bill.md
  read-teacups:
    kind: read
    paths:
      - world/dining-car/two-teacups.md
  search:
    kind: search
    spot: scene
  talk-laohe:
    kind: talk
    npc: world/dining-car/lao-he.md
search:
  - id: scene
    skill: spot_hidden
    label: サイコロで食堂車を捜索する
    title: 食堂車を捜索する
    body: |-
      カウンター、食卓、湯沸かし器、石炭入れ。賀じいはまだ居眠りしている。

      1d100（目星 60）：技能値以下で成功、低いほど良い。
      96–100（5%）：暗闇で手違いが起き、軽くない怪我を負う。手がかりは半分しか得られず、時間を余分に一歩消費する。「遠回り」が開き、もう一歩使えば鍵は手に入る。
      61–95（35%）：うまく調べられなかった。手がかりは半分しか得られず、時間を余分に一歩消費する。「遠回り」が開き、もう一歩使えば鍵は手に入る。
      13–60（48%）：成功。手がかりを得て、時間は一歩だけ消費する。
      1–12（12%）：大成功。手がかりを得て、さらに少し多く見え、しかも素早くて時間を消費しない。

      振るたびに発車が近づく（失敗ならさらに一歩、大成功なら一歩取り戻す）。同じカードは一度しか振れず、振り直しはできない。時間をかけたくなければ、まず振らずに列車へ戻る。
    roll_dice:
      type: 2d10
      desc: 食堂車を捜索する
      expect: ">=11"
    choice:
      options:
        - id: back
          label: まずダイスを振らず、列車へ戻る
    choice_actions:
      back:
        kind: enter
        target: map
    dice_outcomes:
      - min: 2
        max: 4
        harm: serious
        text: まず車両の連結部へ手探りで向かった。非常灯はそこまで届かず、揺れる渡り板をまたいで5号車の入口をのぞこうとして足を踏み外し、すねを連結器に強く打ちつけた。物音で賀じいが目を覚まし、あなたをつかまえてあれこれ問いただし、カウンターの向こうへ行く前に追い出してしまった。出がけに、湯沸かし器のそばの石炭入れの縁の灰が誰かにかき回されているのが目に入った。中に何があるのかは、見る暇がなかった。
        options:
          - id: long-way
            label: 遠回り：石炭入れをひっくり返す
            action:
              kind: read
              paths:
                - world/dining-car/05-long-way.md
          - id: back
            label: 列車へ戻る
            action:
              kind: enter
              target: map
        rewards:
          - path: world/dining-car/freight-key-half.md
            title: 半分の手がかり・かき回された石炭の灰
            partial: true
            body: 食堂車の湯沸かし器のそば、石炭入れの縁の灰は、賀じいが目を覚ます前に誰かにかき回されていた。石炭入れの中に何があるのかは、まだ見ていない。
      - min: 5
        max: 10
        text: まずカウンターとテーブルの下を探し、湯沸かし器のほうを思いついた頃には、賀じいが目を覚まして自分で石炭をくべていた。気づけたのは、彼が行く前から石炭入れの縁の灰がかき回されていたことだけだ。
        options:
          - id: long-way
            label: 遠回り：石炭入れをひっくり返す
            action:
              kind: read
              paths:
                - world/dining-car/05-long-way.md
          - id: back
            label: 列車へ戻る
            action:
              kind: enter
              target: map
        rewards:
          - path: world/dining-car/freight-key-half.md
            title: 半分の手がかり・かき回された石炭の灰
            partial: true
            body: 食堂車の湯沸かし器のそば、石炭入れの縁の灰は、賀じいが目を覚ます前に誰かにかき回されていた。石炭入れの中に何があるのかは、まだ見ていない。
      - min: 11
        max: 17
        text: 石炭入れのそばの石炭の灰は誰かにかき乱されていた。湯沸かし器のそばの石炭入れの中、石炭の下に、「5号車
          荷物車」の赤札が付いた鍵が一本。誰かが運転室に掛け戻す勇気がなく、ここに放り込んだのだ。
        options:
          - id: back
            label: 列車へ戻る
            action:
              kind: enter
              target: map
          - id: to-freight
            label: 車尾の荷物車へ行く
            action:
              kind: enter
              target: world/freight-car
        rewards:
          - path: world/dining-car/freight-key.md
            image: assets/items/freight-key.webp
            title: 赤札付きの5号車の鍵
            body: 食堂車の湯沸かし器のそばの石炭入れで見つけた鍵。赤札には「5号車
              荷物車」と書かれている。誰かが運転室に掛け戻す勇気がなく、ここに放り込んだのだ。これを持てば、車尾の荷物車を開けられる。
      - min: 18
        max: 20
        text: 石炭入れのそばの石炭の灰は誰かにかき乱されていた。湯沸かし器のそばの石炭入れの中、石炭の下に、「5号車
          荷物車」の赤札が付いた鍵が一本。誰かが運転室に掛け戻す勇気がなく、ここに放り込んだのだ。石炭の灰には革靴の跡が半分残っており、古い型の硬い底の革靴だった。まっすぐ石炭入れへ向かった。この捜索は時間を消費しない。
        options:
          - id: back
            label: 列車へ戻る
            action:
              kind: enter
              target: map
          - id: to-freight
            label: 車尾の荷物車へ行く
            action:
              kind: enter
              target: world/freight-car
        rewards:
          - path: world/dining-car/freight-key.md
            image: assets/items/freight-key.webp
            title: 赤札付きの5号車の鍵
            body: 食堂車の湯沸かし器のそばの石炭入れで見つけた鍵。赤札には「5号車
              荷物車」と書かれている。誰かが運転室に掛け戻す勇気がなく、ここに放り込んだのだ。これを持てば、車尾の荷物車を開けられる。
        bonus:
          clock: 1
    on:
      roll_resolved:
        - run: train-step
        - when: roll.rank <= 2
          run: miss-dining
          on_error: continue
map:
  plan:
    picture: assets/maps/dining-car.webp
    pins:
      lao-he:
        - 0.7
        - 0.56
      tea-bill:
        - 0.39
        - 0.4
      two-teacups:
        - 0.42
        - 0.32
      freight-key:
        - 0.88
        - 0.4
      player:
        - 0.5
        - 0.74
view: canvas
---

食堂車にはまだ少し料理の匂いが残っている。料理人の賀じいはカウンターに突っ伏して居眠りし、湯沸かし器が車両の端でぐつぐつと音を立てている。

4号卓の二つの茶碗はまだ下げられておらず、卓の隅にレシートが一枚挟まれている。その先は、鍵のかかった荷物車だ。
