---
type: gate
name: 3車・寝台車
bg: assets/scenes/sleeper.webp
title: 3車・寝台車
intent: 第二幕の筋の一つ（寝台車の謎：グレーのウールコートは誰のものか、彼は本当に眠っていたのか）。鐘懐礼は3号個室の下段にいる。彼は登録キャラクターで、十一時半に薬を飲んで寝たと嘘をつく。面前で実物を突きつけられた時にだけ口を緩め、しかも日誌のページの行方を自分から明かすことは決してない。彼の個室を捜索するにはサイコロカードを使い、語りで直接薬板を出してはならない。捜索がうまくいかなかった（61–100）ときは遠回りカード05-long-way.mdが開く（command/miss-sleeper.yaml）。選ぶと時間を一歩余計に使い、薬のシートが持ち物に入る（command/long-way-sleeper.yaml）。
choice:
  options:
    - id: read-coat
      label: 3号個室の入口に掛かったコートを見る
      once: true
    - id: search
      label: サイコロで3号個室を捜索する
    - id: talk
      label: ノックして、鐘懐礼と話す
      to: writer
    - id: ask-sleep
      label: 十一時半にはもう寝ていたんですか？
      to: zhong-huaili
      say: 鐘さん、本当に十一時半にはもう寝ていたんですか？
    - id: ask-coat
      label: 扉口のコート、あなたのですよね？
      to: zhong-huaili
      say: 扉口に掛かっているグレーのウールコート、あなたのですよね？
  allow_free: true
choice_actions:
  read-coat:
    kind: read
    paths:
      - world/sleeper/grey-coat.md
  search:
    kind: search
    spot: scene
  talk:
    kind: character
    character: zhong-huaili
search:
  - id: scene
    skill: stealth
    label: サイコロで3号個室を捜索する
    title: 3号個室を捜索する
    body: |-
      鐘懐礼は扉に背を向けて横たわっている。彼を起こさずに寝台を調べなければならない。

      1d100（隠密 60）：技能値以下で成功、低いほど良い。
      96–100（5%）：彼が起きた。手掛かりは半分しか得られず、時間を余分に二歩使う。「遠回り」が開き、もう一歩使えば薬のシートは手に入る。
      61–95（35%）：うまく運ばなかった。手掛かりは半分しか得られず、時間を余分に一歩使う。「遠回り」が開き、もう一歩使えば薬のシートは手に入る。
      13–60（48%）：成功。手掛かりを得て、時間は一歩だけ使う。
      1–12（12%）：大成功。手掛かりを得て、さらに少し多く見え、しかも素早くて時間を使わない。

      振るたびに発車が近づく（失敗ならさらに一歩、大成功なら一歩取り戻す）。同じカードは一度しか振れず、振り直しはできない。時間をかけたくなければ、まず振らずに列車へ戻る。
    roll_dice:
      type: 2d10
      desc: 3号個室を捜索する
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
        text: 彼は起きた。鐘懐礼は起き上がり、枕に手を置いたまま、あなたが個室から下がるまで一言も発さずに見ている。それから呼び出しボタンを押し、「見知らぬ者に荷物を探られた」と言って夏澄とあなたを通路で長いこと引き留めた。見えたのは、枕の下からのぞく銀紙のシートの角だけだ。彼はもう、あなたが自分を調べていることを知っている。
        options:
          - id: long-way
            label: 遠回り：夏澄に彼を呼び出してもらう
            action:
              kind: read
              paths:
                - world/sleeper/05-long-way.md
          - id: back
            label: 列車へ戻る
            action:
              kind: enter
              target: map
          - id: to-dining
            label: 食堂車へ行く
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip-half.md
            title: 半分の手掛かり・銀紙の角
            partial: true
            body: 鐘懐礼の枕の下に銀紙の薬のシートがある。見えたのは角だけで、書かれた名前も、何錠減っているかも分からない。彼は十一時半に薬を飲んで寝たと言っている。
        cost:
          clock: -1
      - min: 5
        max: 10
        text: 動きが遅すぎた。彼が寝返りを打ち、手がちょうど枕の上に落ちる。しばらく待ってからでないと下がれなかった。見えたのは、枕の下からのぞく銀紙のシートの角だけだ。
        options:
          - id: long-way
            label: 遠回り：夏澄に彼を呼び出してもらう
            action:
              kind: read
              paths:
                - world/sleeper/05-long-way.md
          - id: back
            label: 列車へ戻る
            action:
              kind: enter
              target: map
          - id: to-dining
            label: 食堂車へ行く
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip-half.md
            title: 半分の手掛かり・銀紙の角
            partial: true
            body: 鐘懐礼の枕の下に銀紙の薬のシートがある。見えたのは角だけで、書かれた名前も、何錠減っているかも分からない。彼は十一時半に薬を飲んで寝たと言っている。
      - min: 11
        max: 17
        text: 枕の下に睡眠薬のシートが挟まれ、処方箋には「鐘懐礼」と印刷されている。十錠入りで二錠減っており、銀紙は新しく破かれている。
        options:
          - id: press
            label: この薬、二錠足りない
            to: zhong-huaili
            say: あなたの睡眠薬、二錠なくなっています。二錠も飲んだ人が、こんなに眠りが浅いはずはない。
            action:
              kind: character
              character: zhong-huaili
          - id: back
            label: 列車へ戻る
            action:
              kind: enter
              target: map
          - id: to-dining
            label: 食堂車へ行く
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip.md
            image: assets/items/pill-strip.webp
            title: 二錠減った睡眠薬のシート
            body: 鐘懐礼の枕の下にあった睡眠薬のシートで、処方箋には彼の名前が印刷されている。十錠入りで二錠減っており、銀紙は新しく破かれている。彼は十一時半に薬を飲んで寝たと言う——だが睡眠薬を二錠飲んだ人間の眠りは、こんなに浅いはずがない。
      - min: 18
        max: 20
        text: 枕の下に睡眠薬のシートが挟まれ、処方箋には「鐘懐礼」と印刷されている。十錠入りで二錠減っており、銀紙は新しく破かれている。彼のトランクは半開きで、中には断雲トンネル事故十二周年追悼式の挨拶原稿がある。彼が身じろぎする前に出てこられた。この捜索は時間を使わない。
        options:
          - id: press
            label: この薬、二錠足りない
            to: zhong-huaili
            say: あなたの睡眠薬、二錠なくなっています。二錠も飲んだ人が、こんなに眠りが浅いはずはない。
            action:
              kind: character
              character: zhong-huaili
          - id: back
            label: 列車へ戻る
            action:
              kind: enter
              target: map
          - id: to-dining
            label: 食堂車へ行く
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip.md
            image: assets/items/pill-strip.webp
            title: 二錠減った睡眠薬のシート
            body: 鐘懐礼の枕の下にあった睡眠薬のシートで、処方箋には彼の名前が印刷されている。十錠入りで二錠減っており、銀紙は新しく破かれている。彼は十一時半に薬を飲んで寝たと言う——だが睡眠薬を二錠飲んだ人間の眠りは、こんなに浅いはずがない。
        bonus:
          clock: 1
    on:
      roll_resolved:
        - run: train-step
        - when: roll.rank <= 2
          run: miss-sleeper
          on_error: continue
map:
  plan:
    picture: assets/maps/sleeper.webp
    pins:
      grey-coat:
        - 0.53
        - 0.28
      pill-strip:
        - 0.64
        - 0.22
      zhong-huaili:
        - 0.58
        - 0.44
      player:
        - 0.5
        - 0.78
view: canvas
passive:
  - id: breath
    skill: listen
    say: "3号室の寝息が整いすぎている。薬で眠りこけた人じゃない、扉の外を聞いている人の息だ。"
    great:
      say: "3号室の寝息が整いすぎている。薬で眠りこけた人じゃない、扉の外を聞いている人の息だ。枕元の小さな灯りの笠がまだ温かい——消したばかりだ。"
---

寝台車の通路はとても狭く、個室の扉はほとんど閉まっている。3号個室の扉だけが半開きで、入口にグレーのウールコートが掛かっている。

中の人は扉に背を向けて横たわり、呼吸はとても規則的だ——規則的すぎて、少しわざとらしい。
