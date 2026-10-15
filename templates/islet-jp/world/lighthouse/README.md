---
type: readme
name: 灯台
bg: assets/scenes/lighthouse.webp
title: 灯台
intent: 鈴ばあちゃんの縄張り。彼女の天気読みは外れない。コンテキストの「明日の天気」を口にできるのは彼女だけで、それも空を読む言葉（雲の足、風向き、海鳥）で言うこと。数字では言わない。灯台に上って付き合うのは
  command/visit-lighthouse.yaml。冬の最後の日の年越し茶はここで開かれる。
choice:
  options:
    - id: climb
      label: 灯台に上り、鈴ばあちゃんと空を眺める
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "climb"
      run: visit-lighthouse
      on_error: continue
---

白い灯台が島でいちばん高い岬に立ち、らせん階段がぐるぐると上へ続く。灯室のガラスは曇りひとつなく、望遠鏡が西の海を向いている。

塔の下の小屋には古い置き時計と、何十年分もの天気を書きつけた帳面がある。
