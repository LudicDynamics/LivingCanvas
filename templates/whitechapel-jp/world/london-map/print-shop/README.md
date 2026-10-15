---
type: gate
name: 印刷所 · トムに聞こう
title: 印刷所 · トムに聞こう
bg: assets/backgrounds/press.webp
intent: ここで名前を挙げた記録は、プレイヤーが調べてダイスを振った後に初めて現れる。それより前に見せたり語ったりしない。receipt.md と
  shift-ledger.md を示す。トムは記録した受渡しと自分の勤務だけ知る。編集者は editor-office、画家は
  illustration-room に実在する。会話がまだなら既に証言を得たことにしない。
choice:
  options:
    - id: search
      label: ここを調べる（ダイス）
    - id: action-1
      label: トムに原稿と挿絵の順番を聞く
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/press.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: tom
search:
  - id: scene
    skill: spot_hidden
    label: ここを調べる（ダイス）
    title: 原稿の流れをつかむ
    body: |-
      ここを自分で調べることにした。手掛かりはまだ見つかっていない。ダイスを振った後に初めて出てくる。

      1d100：小さいほど良い結果。60以下で成功。
      1–12：大成功。手掛かりに加えて、核心の覚え書きが残る。
      13–60：成功。手掛かりと調査の覚え書きが見つかる。
      61–95：失敗。半分しか見えない。手に入るのは手掛かりそのものではなく、何が足りないかを書いた半端な手掛かりで、時間も余計にかかる。
      96–100：大失敗。半端な手掛かりだけが残り、時間を大きく失う。急ぎすぎて怪我をするかもしれない。

      時計は正午へ進む。失敗は一目盛り、大失敗は二目盛りの時間を使う。見落とした手掛かりが事件から消えるわけではなく、ほかの場所が真相へ導くこともある。一か所につき調べられるのは一度だけで、振り直しはできない。ダイスが止まったら、作家が何が見つかったかを語る。
    roll_dice:
      type: 1d100
      desc: 原稿の流れをつかむ
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
        text: 核心だけでなく、次に確かめる手順まで見えた。原稿は編集者から画家へ渡り、絵は事件前に納品された。作品を先に知る人物と、事件後に知る人物を区別できる。
          原本を示して質問すれば、推測と証言を分けて確かめられる。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt.md
                - world/london-map/print-shop/shift-ledger.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt.md
            title: 原稿と絵を受け取った記録
            body: |-
              一週間前：編集者ブラックバーンがイーディスの原稿を受け取り、画家ウェインへ渡した。
              昨日の午後六時：ウェインが三件目の絵を届けた。
              今朝六時：三件目の事件が起きた。
              今朝八時：イーディスが、四件目の住所を変えた原稿を届けた。

              絵は事件より先にありました。原稿を読んだ人が、事件を準備できたはずです。編集室と画室で話を聞きましょう。
          - path: world/london-map/print-shop/shift-ledger.md
            title: トムの勤務記録
            body: |-
              事件の夜、トムは印刷所で働いていました。仕事を交代した人の署名もあります。

              これはトムの説明を確かめる材料です。トムは原稿の受け渡しを知っていますが、外で起きた犯行を見たわけではありません。
            portable: false
          - path: world/london-map/print-shop/investigation-great-success.md
            title: 核心を記した覚え書き
            body: 核心だけでなく、次に確かめる手順まで見えた。原稿は編集者から画家へ渡り、絵は事件前に納品された。作品を先に知る人物と、事件後に知る人物を区別できる。
              原本を示して質問すれば、推測と証言を分けて確かめられる。
      - min: 13
        max: 60
        text: 観察がつながった。原稿は編集者から画家へ渡り、絵は事件前に納品された。作品を先に知る人物と、事件後に知る人物を区別できる。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt.md
                - world/london-map/print-shop/shift-ledger.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt.md
            title: 原稿と絵を受け取った記録
            body: |-
              一週間前：編集者ブラックバーンがイーディスの原稿を受け取り、画家ウェインへ渡した。
              昨日の午後六時：ウェインが三件目の絵を届けた。
              今朝六時：三件目の事件が起きた。
              今朝八時：イーディスが、四件目の住所を変えた原稿を届けた。

              絵は事件より先にありました。原稿を読んだ人が、事件を準備できたはずです。編集室と画室で話を聞きましょう。
          - path: world/london-map/print-shop/shift-ledger.md
            title: トムの勤務記録
            body: |-
              事件の夜、トムは印刷所で働いていました。仕事を交代した人の署名もあります。

              これはトムの説明を確かめる材料です。トムは原稿の受け渡しを知っていますが、外で起きた犯行を見たわけではありません。
            portable: false
          - path: world/london-map/print-shop/investigation-success.md
            title: 調査の覚え書き
            body: 観察がつながった。原稿は編集者から画家へ渡り、絵は事件前に納品された。作品を先に知る人物と、事件後に知る人物を区別できる。
      - min: 61
        max: 95
        text: 当番簿は分厚く、インクもにじんでいる。原稿が編集者から印刷所の誰かへ渡ったことは読めたが、三件目の絵がいつ届いたかは分からない。調べるのに時間がかかりすぎた。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt-half.md
                - world/london-map/print-shop/shift-ledger.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt-half.md
            title: 半分だけ読めた受け取り記録
            body: |-
              受け取り簿はある。だが目を通せたページには、一週間前に編集者ブラックバーンがイーディスの原稿を回したことしか書かれていない。三件目の絵の行はにじんでいるか、めくれなかったページにある。

              まだ足りないもの：絵が印刷所に届いた時刻と、事件の時刻との比較。これがなければ、絵が先だったとは言えない。
            partial: true
          - path: world/london-map/print-shop/shift-ledger.md
            title: トムの勤務記録
            body: |-
              事件の夜、トムは印刷所で働いていました。仕事を交代した人の署名もあります。

              これはトムの説明を確かめる材料です。トムは原稿の受け渡しを知っていますが、外で起きた犯行を見たわけではありません。
            portable: false
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 調べる物音が響き、気付かれずに調べる機会を失った。持ち帰れたのは当番簿の切れ端だけ。高い棚から当番簿を引き抜いたとき、隣の活字棚がまるごと倒れ、肩を直撃した。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt-half.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt-half.md
            title: 半分だけ読めた受け取り記録
            body: |-
              受け取り簿はある。だが目を通せたページには、一週間前に編集者ブラックバーンがイーディスの原稿を回したことしか書かれていない。三件目の絵の行はにじんでいるか、めくれなかったページにある。

              まだ足りないもの：絵が印刷所に届いた時刻と、事件の時刻との比較。これがなければ、絵が先だったとは言えない。
            partial: true
        harm: serious
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-picture
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/print-shop.webp
    pins:
      editor-office:
        - 0.14
        - 0.18
      illustration-room:
        - 0.82
        - 0.16
      tom:
        - 0.5
        - 0.3
      receipt:
        - 0.14
        - 0.45
      shift-ledger:
        - 0.74
        - 0.47
      player:
        - 0.5
        - 0.8
---

印刷工のトムが、仕事の記録を見せてくれます。ここでは「誰が原稿を読んだか」「絵がいつ届いたか」を調べられます。

ここの記録を調べるか、トムに聞いてみましょう。奥の編集室にはブラックバーン、画室にはウェインがいます。
