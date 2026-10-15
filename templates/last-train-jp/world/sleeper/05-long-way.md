---
type: chalk
title: 遠回り・夏澄に検札で呼び出してもらう
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 夏澄に鐘懐礼を通路へ呼び出して検札してもらい、その隙に枕の下を見る（時間を一歩余計に使う）
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: long-way-sleeper
      on_error: continue
---

この道は、個室の捜索がうまくいかなかった（61–100）あとにだけ開く。

夏澄に頼んで、通路で鐘懐礼の切符を検めてもらい、できるだけ話を引き延ばしてもらう。個室は一分だけ空になる。枕をめくって薬のシートを取る。

薬のシートは同じように手に入る。ただ時間を一歩余計に使う。手に入れたら、もうここへ戻る必要はない。
