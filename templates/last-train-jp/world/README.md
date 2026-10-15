---
type: readme
name: 断雲トンネル · 停まった終電
bg: assets/scenes/tunnel-train.webp
title: 断雲トンネル · 停まった終電
intent: 列車全体の総覧。第二幕はここから始まる。三幕構成：第一幕は2号車・硬座車（開始地点）；第二幕はこの地図から3号車・寝台車、4号車・食堂車、1号車・運転室へ行く。三つの筋は順不同で、それぞれに謎が一つある；第三幕は5号車・荷物車で、鍵がかかっており、player/freight-key.md
  が鞄にあるときだけ入れる。制限時間は world/departure-clock.md の status.data.left で、エンジンの tick
  だけが変えられる。作家は手で変えないこと。語りで施錠された扉を開けず、語りで結末を宣言しないこと。
states:
- id: turns
  label: "ターン"
  type: number
  initial: 0
  range:
  - 0
  - 999
  hidden: true
choice:
  options:
    - id: go-sleeper
      label: 3号車・寝台車へ行く
    - id: go-dining
      label: 4号車・食堂車へ行く
    - id: go-cab
      label: 1号車・運転室へ行く
    - id: read-list
      label: 夏澄の乗客名簿を見る
      once: true
    - id: ask-awake
      label: この時間、誰がまだ起きてる？
      to: companion
      say: この時間、車内でほかに誰がまだ起きてる？
  allow_free: true
choice_actions:
  go-sleeper:
    kind: enter
    target: world/sleeper
  go-dining:
    kind: enter
    target: world/dining-car
  go-cab:
    kind: enter
    target: world/cab
  read-list:
    kind: read
    paths:
      - world/passenger-list.md
map:
  plan:
    picture: assets/maps/tunnel-train.webp
    pins:
      cab:
        - 0.19
        - 0.39
      seated-car:
        - 0.34
        - 0.39
      sleeper:
        - 0.52
        - 0.39
      dining-car:
        - 0.7
        - 0.39
      freight-car:
        - 0.89
        - 0.39
      departure-clock:
        - 0.12
        - 0.2
      passenger-list:
        - 0.34
        - 0.61
      xia-cheng:
        - 0.44
        - 0.6
      player:
        - 0.55
        - 0.6
view: map
---
午前1時過ぎ。嶺口行きK7列車の最終便は、断雲トンネルの真ん中で止まっている。前方で土砂崩れがあり、車内には非常灯しか点いていない。

2号車17番の蘇禾がいなくなった。帆布のバッグと保温カップは座席に残ったままだ。

復旧班は五時ちょうどに開通すると言っている。寝台車、食堂車、運転室——どこから行くかは自由。最後尾の荷物車には鍵がかかっている。
