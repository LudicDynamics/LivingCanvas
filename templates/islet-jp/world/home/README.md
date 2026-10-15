---
type: readme
name: あなたの小屋
bg: assets/scenes/home.webp
title: あなたの小屋
intent: あなたの住まい。眠るのは
  command/sleep.yaml（翌朝の明け方まで。夜のあいだの島民の暮らしはエンジンが計算する）。ここではプレイヤーに眠るよう急かさず、夜更かしにも罰はない。
choice:
  options:
    - id: sleep
      label: 横になって夜明けまで眠る
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "sleep"
      run: sleep
      on_error: continue
---

前の住人が残した小屋：ベッドがひとつ、机がひとつ、薪の小さなストーブ。窓辺には貝殻が並んでいるが、誰が拾ったのかはわからない。

窓からは、灯台の光が海の上をぐるりと照らすのがちょうど見える。
