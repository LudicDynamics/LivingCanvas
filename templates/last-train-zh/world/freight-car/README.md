---
type: gate
name: "5车 · 行李车"
bg: assets/scenes/freight-car.webp
title: "5车 · 行李车"
requires:
  items:
    - player/freight-key.md
blocked: "行李车的门锁着。需要拴着“5车”红牌的钥匙——驾驶室的钥匙板上它不见了，去别的车厢找找。"
view: canvas
intent: "第三幕。苏禾在这里：被下了药、冻得发抖，但活着。她是 NPC 卡 su-he.md（点她「对话」），只能说出 su-he-testimony.md 里的事，能交出的只有她的话：不知道自己是怎么进来的，不知道日志页去了哪儿。决定性判定是 04-confront-dice.md（拦住钟怀礼）：60以下得到 logbook-page，10以下只得到 torn-corner。不要让判定之外的叙述交出日志页。"
choice:
  options:
    - id: take-testimony
      label: "扶起苏禾，听她说话"
    - id: confront
      label: "钟怀礼堵在门口——用骰子拦住他"
    - id: back
      label: "回到列车"
    - id: warm-her
      label: "先给她暖和一下"
      to: companion
      say: "夏澄，把你的棉大衣给她，先让她暖和过来。"
  allow_free: true
choice_actions:
  take-testimony:
    kind: take
    paths:
      - world/freight-car/su-he-testimony.md
  confront:
    kind: read
    paths:
      - world/freight-car/04-confront-dice.md
  back:
    kind: enter
    target: map
map:
  plan:
    picture: assets/maps/freight-car.webp
    pins:
      su-he: [0.24, 0.52]
      su-he-testimony: [0.35, 0.45]
      04-confront-dice: [0.83, 0.25]
      06-radio-relay: [0.62, 0.2]
      player: [0.5, 0.78]
---

行李车里没有暖气，呼出的气都是白的。邮袋堆成一座小山，角落里的铁皮炉子还烧着一点火。

邮袋中间蜷着一个人——是苏禾。她嘴唇发紫，但还有呼吸。

你身后，车门又响了一声。
