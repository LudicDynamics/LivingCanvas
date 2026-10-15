---
type: chalk
title: 遠回り・賀じいと石炭入れをひっくり返す
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 賀じいに手伝ってもらい、石炭入れをひとすくいずつ空ける（時間を一歩余計に消費する）
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: long-way-dining
      on_error: continue
---

この道は、食堂車の捜索がうまくいかなかった（61–100）あとにだけ開く。

賀じいは自分の石炭入れに何が入っているか知らないが、床が汚れるとぼやきながらも、ひとすくいずつ床へ空けるのを手伝ってくれる。石炭の下に埋もれていたのは、赤い札のついた鍵だ。

鍵は同じように手に入る。ただ時間を一歩余計に消費する。手に入れたら、もうここへ戻る必要はない。
