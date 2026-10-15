---
type: gate
name: 外れ島・海藻島
bg: assets/scenes/kelp-islet.webp
title: 外れ島・海藻島
requires:
  items:
    - player/boat-tiller.md
blocked: 海藻島との間には急な潮の流れがあって泳いでは渡れない。まず健太と古い漁船を直そう。
intent: 船を直してから来られる小島。潮が引くと海藻の林が水面に現れる。誰も住んでおらず、ときどき凪が船で海藻を採りに来る。探検は
  command/explore-islet.yaml（午後の大半を使う）。宝や秘密を隠さない。ただ美しく静かな場所だ。
choice:
  options:
    - id: explore
      label: 浅瀬を歩いて海藻の林を巡る
    - id: back
      label: 船で渡し船の甲板に戻る
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

潮が引いた海藻島は緑のビロードの敷物のようで、浅瀬で海藻がゆっくり揺れている。岩の上ではヒトデが日向ぼっこをしている。

ほかに音はなく、波と風だけ。
