---
type: readme
name: あなたの畑
bg: assets/scenes/farm.webp
title: あなたの畑
intent: あなたが継いだ畑。隣は蓮の畑。畑の世話は command/tend-farm.yaml（world/README.md の
  farm_growth が一つ進む。「収穫できる」になるとトリガーが収穫し、初収穫では player/first-turnip.md
  が手に入る）。蓮の手伝いは command/help-ren.yaml。背景は季節で変わる（エンジンの差分絵）ので、違う季節として語らない。
choice:
  options:
    - id: tend
      label: 土を起こし、水をやり、畑の世話をする
    - id: help-ren
      label: 隣の蓮をしばらく手伝う
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "tend"
      run: tend-farm
      on_error: continue
    - when: choice.option_id == "help-ren"
      run: help-ren
      on_error: continue
---

日当たりのいい斜面を低い石垣が囲み、その根元には雑草が茂っている。古い農具が物置に立てかけられ、鍬の柄は黒ずんでいる。

隣の蓮の畑は畝がきちんと並び、まるでお手本を見せてくれているようだ。
