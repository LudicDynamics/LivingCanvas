---
type: chalk
title: 2車・硬座車
intent: 第一幕（開始地点）。蘇禾の座席（17号）とプレイヤーの座席（18号）はどちらもここ。流れ：夏澄が先に話しかける → プレイヤーがノートを手に取る
  → ダイスで20番の学生に尋ねる（証言はこの一振りで得る。「彼と話しに行く」はもう既定の選択肢にしない）→ 証言を得る → 3号車・寝台車へ、または列車の地図へ戻る（証言を得るか、この車両で四拍過ごすと、選択肢の先頭にこの二つの出口が出る）。学生・周子航（20号）は NPC カード
  zhou-zihang.md（彼をクリックして「話す」）で、witness-account.md
  に書かれたことしか話せない：老人の顔ははっきり見ておらず、グレーのウールコートと白髪交じりの髪しか覚えていない。
status:
  data:
    skipped: no
choice:
  options:
    - id: skip-act-one
      label: 学生にはもう序章で聞いた——列車の地図へ直行する
      for: from-prologue
      when: skipped != "yes"
on:
  choice_selected:
    - when: choice.option_id == "skip-act-one"
      run: prologue-carry
      on_error: continue
---

硬座車ではほとんどの人が眠っていて、誰かがコートにくるまって寝息を立てている。17号の座席には帆布の鞄と保温ボトル、それに開いたままのノートが一冊置かれている。

二つ隣の座席の学生・周子航はヘッドホンをつけていて、ずっと起きているようだ。
