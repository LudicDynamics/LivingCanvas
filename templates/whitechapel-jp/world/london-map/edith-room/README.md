---
type: gate
name: 221Bの客間 · 作者の話
title: 221Bの客間 · 作者の話
bg: assets/backgrounds/intro.webp
intent: ここで名前を挙げた記録は、プレイヤーが調べてダイスを振った後に初めて現れる。それより前に見せたり語ったりしない。address-correction.md
  を出典に本人の疑いと確定事実を分ける。保護される人にも意思がある。本人を囮として外へ出す同意を勝手に作らない。
choice:
  options:
    - id: search
      label: ここを調べる（ダイス）
    - id: action-1
      label: 住所を変えた理由を聞く
    - id: action-2
      label: 誰に訂正稿を渡したか聞く
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/intro.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: edith
  action-2:
    kind: character
    character: edith
search:
  - id: scene
    skill: psychology
    label: ここを調べる（ダイス）
    title: 架空の住所の意図を解く
    body: |-
      ここを自分で調べることにした。手掛かりはまだ見つかっていない。ダイスを振った後に初めて出てくる。

      1d100：小さいほど良い結果。60以下で成功。
      1–12：大成功。手掛かりに加えて、皆が見落としたものをもう一つ見つける。
      13–60：成功。手掛かりと調査の覚え書きが見つかる。
      61–95：失敗。半分しか見えない。手に入るのは手掛かりそのものではなく、何が足りないかを書いた半端な手掛かりで、時間も余計にかかる。
      96–100：大失敗。半端な手掛かりだけが残り、時間を大きく失う。調べる物音に誰かが気付く。

      時計は正午へ進む。失敗は一目盛り、大失敗は二目盛りの時間を使う。見落とした手掛かりが事件から消えるわけではなく、ほかの場所が真相へ導くこともある。一か所につき調べられるのは一度だけで、振り直しはできない。ダイスが止まったら、作家が何が見つかったかを語る。
    roll_dice:
      type: 1d100
      desc: 架空の住所の意図を解く
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
        text: 核心だけでなく、次に確かめる手順まで見えた。イーディスは架空の住所で反応を試した。そこへ人を呼ぶ計画ではない。誰へ訂正が渡ったかを追おう。
          原本を示して質問すれば、推測と証言を分けて確かめられる。イーディスの原稿の写しには、彼女自身の書き込みも挟まっていた。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction.md
                - world/london-map/edith-room/margin-note.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction.md
            title: イーディスが住所を変えた理由
            body: |-
              イーディスは今朝、小説の住所を実在しない通りへ変え、編集者に渡しました。

              「そこへ行こうとする人なら、そんな通りはないと気づくでしょう。誰が困って聞き返すのか知りたかったんです」。

              これは彼女が考えた調べ方です。まだ犯人を見つけたわけではありません。その原稿を次に誰が読んだか、編集室の記録で確かめられます。
          - path: world/london-map/edith-room/margin-note.md
            title: 余白の一行
            body: |-
              イーディスの原稿の写し、第三章のページの余白に、彼女の鉛筆の字がある。「帽子？　帽子なんて書いていない。椅子も窓際じゃない」

              第三現場の帽子と椅子は挿絵とそっくり同じなのに、彼女の小説には出てこない。現場を仕組んだ人物が見ていたのは、文章ではなく絵だ。
      - min: 13
        max: 60
        text: 観察がつながった。イーディスは架空の住所で反応を試した。そこへ人を呼ぶ計画ではない。誰へ訂正が渡ったかを追おう。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction.md
            title: イーディスが住所を変えた理由
            body: |-
              イーディスは今朝、小説の住所を実在しない通りへ変え、編集者に渡しました。

              「そこへ行こうとする人なら、そんな通りはないと気づくでしょう。誰が困って聞き返すのか知りたかったんです」。

              これは彼女が考えた調べ方です。まだ犯人を見つけたわけではありません。その原稿を次に誰が読んだか、編集室の記録で確かめられます。
          - path: world/london-map/edith-room/investigation-success.md
            title: 調査の覚え書き
            body: 観察がつながった。イーディスは架空の住所で反応を試した。そこへ人を呼ぶ計画ではない。誰へ訂正が渡ったかを追おう。
      - min: 61
        max: 95
        text: 四章の住所が変えられていることは分かったが、理由は分からない。イーディスはまだ怯えていて説明できない。調べるのに時間がかかりすぎた。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction-half.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction-half.md
            title: 理由の分からない住所の変更
            body: |-
              イーディスの下書きでは、四章の住所が線で消され、別の通りに書き換えられている。なぜ変えたのかは原稿に書かれておらず、彼女も動揺していて話せなかった。

              まだ足りないもの：彼女の理由。これがなければ、新しい住所はただの訂正にしか見えない。
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 調べる物音が響き、気付かれずに調べる機会を失った。イーディスは原稿を取り戻し、しばらくは見せてくれそうにない。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction-half.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction-half.md
            title: 理由の分からない住所の変更
            body: |-
              イーディスの下書きでは、四章の住所が線で消され、別の通りに書き換えられている。なぜ変えたのかは原稿に書かれておらず、彼女も動揺していて話せなかった。

              まだ足りないもの：彼女の理由。これがなければ、新しい住所はただの訂正にしか見えない。
            partial: true
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-address
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/edith-room.webp
    pins:
      address-correction:
        - 0.36
        - 0.38
      edith:
        - 0.78
        - 0.53
      player:
        - 0.47
        - 0.85
---

小説家のイーディスは、ここでワトソンに守られています。「小説は私が書きました。でも、人を傷つけるつもりはなかったんです」。

彼女は今朝、小説の住所を変えました。なぜ変えたのか、誰に渡したのかを聞いてみましょう。
