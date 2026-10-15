---
type: chalk
title: 架空の住所の意図を解く
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
      原本を示して質問すれば、推測と証言を分けて確かめられる。
    options:
      - id: read-clue
        label: 手掛かりを読む
        action:
          kind: read
          paths: &a1
            - world/london-map/edith-room/address-correction.md
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/edith-room/investigation-great-success.md
        title: 核心を記した覚え書き
        body: 核心だけでなく、次に確かめる手順まで見えた。イーディスは架空の住所で反応を試した。そこへ人を呼ぶ計画ではない。誰へ訂正が渡ったかを追おう。
          原本を示して質問すれば、推測と証言を分けて確かめられる。
  - min: 13
    max: 60
    text: 観察がつながった。イーディスは架空の住所で反応を試した。そこへ人を呼ぶ計画ではない。誰へ訂正が渡ったかを追おう。
    options:
      - id: read-clue
        label: 手掛かりを読む
        action:
          kind: read
          paths: *a1
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/edith-room/investigation-success.md
        title: 調査の覚え書き
        body: 観察がつながった。イーディスは架空の住所で反応を試した。そこへ人を呼ぶ計画ではない。誰へ訂正が渡ったかを追おう。
  - min: 61
    max: 95
    text: すぐには結び付かなかったが、手掛かりを見直す方向はつかめた。イーディスは架空の住所で反応を試した。そこへ人を呼ぶ計画ではない。誰へ訂正が渡ったかを追おう。
    options:
      - id: read-clue
        label: 手掛かりを読む
        action:
          kind: read
          paths: *a1
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/edith-room/investigation-setback.md
        title: 見落としと次の手掛かり
        body: すぐには結び付かなかったが、手掛かりを見直す方向はつかめた。イーディスは架空の住所で反応を試した。そこへ人を呼ぶ計画ではない。誰へ訂正が渡ったかを追おう。
  - min: 96
    max: 100
    text: 調査の物音が響き、気付かれずに調べる機会を失った。まだ糸口はある。イーディスは架空の住所で反応を試した。そこへ人を呼ぶ計画ではない。誰へ訂正が渡ったかを追おう。
    options:
      - id: read-clue
        label: 手掛かりを読む
        action:
          kind: read
          paths: *a1
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/edith-room/investigation-setback.md
        title: 見落としと次の手掛かり
        body: 調査の物音が響き、気付かれずに調べる機会を失った。まだ糸口はある。イーディスは架空の住所で反応を試した。そこへ人を呼ぶ計画ではない。誰へ訂正が渡ったかを追おう。
---

難しい時は、ダイスで登場人物に調査を任せられます。自分で考えたい時は、振らずに戻っても大丈夫です。

1d100：低い数字ほど良い結果です。調査成功率60%、60以下で成功。
1–12（12%）：大成功。追加の発見を含む記録を得ます。
13–60（48%）：成功。手掛かりの意味と次の手順を得ます。
61–95（35%）：失敗。見落としと次の手掛かりを記録します。
96–100（5%）：重大な失敗。気付かれて調査の機会を失いますが、唯一の道は閉ざされません。

失敗しても、ここで行き止まりにはなりません。同じダイスの振り直しはできません。結果を見てから、続きを選べます。新しい場所を作る時だけ、作家への送信が必要です。
