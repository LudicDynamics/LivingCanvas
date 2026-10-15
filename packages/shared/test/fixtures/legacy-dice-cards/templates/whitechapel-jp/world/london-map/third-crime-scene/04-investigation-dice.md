---
type: chalk
title: 構図の違和感を見抜く
roll_dice:
  type: 1d100
  desc: 構図の違和感を見抜く
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
    text: 核心だけでなく、次に確かめる手順まで見えた。椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。
      原本を示して質問すれば、推測と証言を分けて確かめられる。
    options:
      - id: read-clue
        label: 手掛かりを読む
        action:
          kind: read
          paths: &a1
            - world/london-map/third-crime-scene/pigment-record.md
      - id: back
        label: 地図へ戻る
        action:
          kind: enter
          target: world/london-map
    rewards:
      - path: world/london-map/third-crime-scene/investigation-great-success.md
        title: 核心を記した覚え書き
        body: 核心だけでなく、次に確かめる手順まで見えた。椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。
          原本を示して質問すれば、推測と証言を分けて確かめられる。
  - min: 13
    max: 60
    text: 観察がつながった。椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。
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
      - path: world/london-map/third-crime-scene/investigation-success.md
        title: 調査の覚え書き
        body: 観察がつながった。椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。
  - min: 61
    max: 95
    text: すぐには結び付かなかったが、手掛かりを見直す方向はつかめた。椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。
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
      - path: world/london-map/third-crime-scene/investigation-setback.md
        title: 見落としと次の手掛かり
        body: すぐには結び付かなかったが、手掛かりを見直す方向はつかめた。椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。
  - min: 96
    max: 100
    text: 調査の物音が響き、気付かれずに調べる機会を失った。まだ糸口はある。椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。
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
      - path: world/london-map/third-crime-scene/investigation-setback.md
        title: 見落としと次の手掛かり
        body: 調査の物音が響き、気付かれずに調べる機会を失った。まだ糸口はある。椅子と帽子まで同じ。偶然ではなく、誰かが絵に合わせて現場を配置した疑いがある。群青と右手の痕跡を画家に確かめよう。
---

難しい時は、ダイスで登場人物に調査を任せられます。自分で考えたい時は、振らずに戻っても大丈夫です。

1d100：低い数字ほど良い結果です。調査成功率60%、60以下で成功。
1–12（12%）：大成功。追加の発見を含む記録を得ます。
13–60（48%）：成功。手掛かりの意味と次の手順を得ます。
61–95（35%）：失敗。見落としと次の手掛かりを記録します。
96–100（5%）：重大な失敗。気付かれて調査の機会を失いますが、唯一の道は閉ざされません。

失敗しても、ここで行き止まりにはなりません。同じダイスの振り直しはできません。結果を見てから、続きを選べます。新しい場所を作る時だけ、作家への送信が必要です。
