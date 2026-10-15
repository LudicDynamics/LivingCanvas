---
type: gate
name: 画室 · ウェインに聞こう
title: 画室 · ウェインに聞こう
bg: assets/backgrounds/press.webp
intent: ここで名前を挙げた記録は、プレイヤーが調べてダイスを振った後に初めて現れる。それより前に見せたり語ったりしない。visible-details.md
  と回覧記録を根拠に質問を受ける。態度や怪我だけで有罪にしない。未提示の証拠を提示済みにせず、実際の返答を残す。
choice:
  options:
    - id: search
      label: ここを調べる（ダイス）
    - id: action-1
      label: ウェインに手首と絵の納品について聞く
    - id: action-2
      label: 訂正された住所を読んだか確かめる
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/press.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: wayne
  action-2:
    kind: character
    character: wayne
search:
  - id: scene
    skill: psychology
    label: ここを調べる（ダイス）
    title: 画家の説明を検証する
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
      desc: 画家の説明を検証する
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
        text: 核心だけでなく、次に確かめる手順まで見えた。新しい右手の包帯、群青の袖口、事件前に届いた絵。ウェインを重点的に調べる根拠になるが、怪我だけで逮捕はできない。
          原本を示して質問すれば、推測と証言を分けて確かめられる。画架の裏には、突き返された校正刷りの束も挟まっていた。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details.md
                - world/london-map/print-shop/illustration-room/returned-proofs.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details.md
            title: ウェインのけがと絵具
            body: |-
              右手首には新しい包帯。袖には青い絵具。机には住所を変えた原稿があります。

              現場にも青い絵具と、右手をぶつけた跡がありました。ウェインに、いつ、どこでけがをしたか聞けます。絵は事件の前に届いているので、「現場を見て描いた」という説明なら時刻と合いません。
            portable: false
          - path: world/london-map/print-shop/illustration-room/returned-proofs.md
            title: 突き返された校正刷り
            body: |-
              画架の裏に、突き返された校正刷りの束が挟まっている。どれもウェインの挿絵だ。余白にはブラックバーン編集長の赤鉛筆。「来月から連載の挿絵はなし。紙面を空けること」

              いちばん下の一枚には、ウェイン自身の字で。「彼らにも分かる――絵は言葉より先に来る」

              彼がなぜ事件を絵のとおりに起こしたかったのかが分かる。ただしこの紙束そのものは犯罪の証拠ではなく、彼の胸のうちにすぎない。
      - min: 13
        max: 60
        text: 観察がつながった。新しい右手の包帯、群青の袖口、事件前に届いた絵。ウェインを重点的に調べる根拠になるが、怪我だけで逮捕はできない。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details.md
            title: ウェインのけがと絵具
            body: |-
              右手首には新しい包帯。袖には青い絵具。机には住所を変えた原稿があります。

              現場にも青い絵具と、右手をぶつけた跡がありました。ウェインに、いつ、どこでけがをしたか聞けます。絵は事件の前に届いているので、「現場を見て描いた」という説明なら時刻と合いません。
            portable: false
          - path: world/london-map/print-shop/illustration-room/investigation-success.md
            title: 調査の覚え書き
            body: 観察がつながった。新しい右手の包帯、群青の袖口、事件前に届いた絵。ウェインを重点的に調べる根拠になるが、怪我だけで逮捕はできない。
      - min: 61
        max: 95
        text: ウェインは右腕を見せず、ずっと喋り続けている。袖口のしみはちらりと見えたが、問い詰められるものは何もない。調べるのに時間がかかりすぎた。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details-half.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details-half.md
            title: ちらりと見えたウェインの袖口
            body: |-
              ウェインは右腕を画架の陰に隠し、袖も下ろしたままだ。袖口のしみがちらりと見えただけで、それ以上は何も分からなかった。

              まだ足りないもの：手首の様子、しみの色、そして机の上にあるもの。これがなければ、彼に突きつけるものがない。
            partial: true
            portable: false
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 調べる物音が響き、気付かれずに調べる機会を失った。ウェインは机の紙を伏せ、あなたと画架の間に立ちはだかった。
        options:
          - id: read-clue
            label: 手掛かりを読む
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details-half.md
          - id: back
            label: 地図へ戻る
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details-half.md
            title: ちらりと見えたウェインの袖口
            body: |-
              ウェインは右腕を画架の陰に隠し、袖も下ろしたままだ。袖口のしみがちらりと見えただけで、それ以上は何も分からなかった。

              まだ足りないもの：手首の様子、しみの色、そして机の上にあるもの。これがなければ、彼に突きつけるものがない。
            partial: true
            portable: false
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-hand
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/illustration-room.webp
    pins:
      visible-details:
        - 0.39
        - 0.4
      wayne:
        - 0.59
        - 0.44
      player:
        - 0.26
        - 0.86
---

絵を描いたウェインは、右手首に新しい包帯を巻いています。袖には青い絵具。机には、住所を変えた原稿があります。

現場の跡と関係があるかもしれません。手のけがと、絵を届けた時間について聞いてみましょう。まだ、けがだけで犯人とは決められません。
