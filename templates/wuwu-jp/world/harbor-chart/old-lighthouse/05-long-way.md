---
type: chalk
title: 遠回り・老モーに日誌を一分ずつ照合してもらう
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 老モーに日誌と潮汐表を一分ずつ照合してもらう（潮位を一段余計に消費）
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: evidence-tunnel
      on_error: continue
    - when: choice.option_id == "long-way"
      run: long-way-lighthouse
      on_error: continue
---

この道は、旧灯台の調査ダイスで調べ切れなかった（61–100）後にのみ開く。

老モーに頼み込む：日誌を開き、今夜の潮汐表と一分ずつ照合してもらう——さっき望遠鏡を壊してしまったなら、まずしっかり謝ろう。消灯の十二分は、隧道口が水面から出る時間帯に一分の狂いもなく重なる。

これでも旧灯台の糸は留められるが、潮位を一段余計に消費する（十数分）。糸を留めたら、ここに来る必要はもうない。
