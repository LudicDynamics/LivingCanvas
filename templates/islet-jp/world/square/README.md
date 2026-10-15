---
type: readme
name: 村の広場
bg: assets/scenes/square.webp
title: 村の広場
intent: 島の人たちは夕方ここでくつろぐ。日曜の朝は市が立ち、祭り（灯籠祭り、収穫の宴）もここで開かれる。澪と遊ぶのは
  command/play-with-mio.yaml、海のギターを聴くのは
  command/listen-kai.yaml（海が上陸する前は彼はここにおらず、ひとりで少し座っているだけになる）。
choice:
  options:
    - id: play-mio
      label: 澪と少し遊ぶ
    - id: listen-kai
      label: 木陰に座って、ギターの音が聞こえないか耳を澄ます
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "play-mio"
      run: play-with-mio
      on_error: continue
    - when: choice.option_id == "listen-kai"
      run: listen-kai
      on_error: continue
---

古い楠が木陰を広げ、その下にベンチがふたつと、もう使われていない井戸がある。石畳の道がここから分かれ、ひとつは桟橋へ、ひとつは灯台へ上る。

夜、花の店の灯りがともると、みんながゆっくり集まってくる。
