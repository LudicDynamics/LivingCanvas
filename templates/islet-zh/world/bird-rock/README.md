---
type: gate
name: 外岛 · 鸟岩
bg: assets/scenes/bird-rock.webp
title: 外岛 · 鸟岩
requires:
  items:
    - player/boat-tiller.md
blocked: 鸟岩四面都是陡壁和暗礁，只有开船才靠得上去。得先帮健太把那条旧渔船修好。
intent: 海鸟的岛，修好船之后才来得了。春夏有成千上万的海鸟在崖上筑巢。鈴婆婆年轻时常来这里数鸟。探索走
  command/explore-islet.yaml。不要惊扰鸟群，也不要在这里安排危险。
choice:
  options:
    - id: explore
      label: 沿着岩脚慢慢走，看海鸟
    - id: back
      label: 开船回渡轮甲板
  allow_free: true
choice_actions:
  back:
    kind: enter
    target: world/ferry
on:
  choice_selected:
    - when: choice.option_id == "explore"
      run: explore-islet
      on_error: continue
---

黑色的岩壁上密密麻麻全是鸟巢，海鸟的叫声盖过了浪声。岩缝里长着一丛丛开小白花的草。

从这里能看见潮见岛的全貌，灯塔小得像一根火柴。
