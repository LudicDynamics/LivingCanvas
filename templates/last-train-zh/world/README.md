---
type: readme
name: "断云隧道 · 停下的末班车"
bg: assets/scenes/tunnel-train.webp
title: "断云隧道 · 停下的末班车"
view: map
intent: "整列车的总览，第二幕从这里出发。三幕：第一幕在2车硬座（开局入口）；第二幕从这张地图去3车卧铺、4车餐车、1车驾驶室，三条线顺序自由，各有一个谜；第三幕是5车行李车，锁着，只有 player/freight-key.md 在包里才进得去。时限是 world/departure-clock.md 的 status.data.left，只有引擎的 tick 能改它，作家不要手改。不要靠叙述打开锁着的门，也不要靠叙述宣布结局。"
states:
- id: turns
  label: "回合"
  type: number
  initial: 0
  range:
  - 0
  - 999
  hidden: true
choice:
  options:
    - id: go-sleeper
      label: "去3车卧铺"
    - id: go-dining
      label: "去4车餐车"
    - id: go-cab
      label: "去1车驾驶室"
    - id: read-list
      label: "看夏澄的乘客名单"
      once: true
    - id: ask-awake
      label: "这个点谁还醒着？"
      to: companion
      say: "这个点，车上还有谁醒着？"
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
      cab: [0.19, 0.39]
      seated-car: [0.34, 0.39]
      sleeper: [0.52, 0.39]
      dining-car: [0.7, 0.39]
      freight-car: [0.89, 0.39]
      departure-clock: [0.12, 0.2]
      passenger-list: [0.34, 0.61]
      xia-cheng: [0.44, 0.6]
      player: [0.55, 0.6]
---

凌晨一点多。开往岭口的K7次末班车停在断云隧道正中间：前方塌方，车厢里只剩应急灯。

2车17号的苏禾不见了，帆布包和保温杯还留在座位上。

抢修队说五点整通车。卧铺、餐车、驾驶室，先去哪节随你；最后一节行李车是锁着的。
