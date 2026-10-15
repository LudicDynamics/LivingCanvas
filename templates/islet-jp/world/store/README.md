---
type: readme
name: 花の雑貨屋
bg: assets/scenes/store.webp
title: 花の雑貨屋
intent: 島で唯一の店。何でも少しずつ置いていて、島民の魚や野菜も預かって売る。噂がいちばん早く届くのは花のところ。花に魚を預けるのは
  command/sell-fish.yaml（魚籠が空になり、花との仲が深まる）。雨の日は健太や蓮が雨宿りに来る。
choice:
  options:
    - id: sell-fish
      label: 魚籠の魚を花に預けて売ってもらう
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "sell-fish"
      run: sell-fish
      on_error: continue
---

ドアベルがちりんと鳴る。床から天井まで棚が続く——缶詰、種、麻縄、懐中電灯、梅干しの瓶。レジの横には文字でびっしりの帳簿が開いている。

カウンターの奥には、いつも熱いお茶がある。
