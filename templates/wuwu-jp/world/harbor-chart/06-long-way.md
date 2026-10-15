---
type: chalk
title: 遠回り・岸沿いに航跡を追う
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 岸沿いに航跡を追って歩く（潮位を一段余計に消費）
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: evidence-wake
      on_error: continue
    - when: choice.option_id == "long-way"
      run: long-way-chart
      on_error: continue
---

この道は、海図上の決定的判定で見えなかった（61–95、または96–100で灯を点けて持ちこたえた）後にのみ開く。

最も外側の足場で無理に凝視するのではなく、岸沿いに航跡を追って旧税関隧道の入り口の外まで歩く。歩みは遅いが、一歩一歩が確かだ：その航跡は隧道口から出て、無人船をかすめて通り、また霧の中へ折れていく。

これでも海図上の糸は留められるが、潮位を一段余計に消費する（十数分）。糸を留めたら、ここに来る必要はもうない。
