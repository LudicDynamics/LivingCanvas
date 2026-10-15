---
type: chalk
title: 遠回り・ヴェラに注文帳を調べてもらう
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: ヴェラに工房の注文帳を調べてもらう（潮水を余分に一段消費）
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: evidence-ledger
      on_error: continue
    - when: choice.option_id == "long-way"
      run: long-way-workshop
      on_error: continue
---

この道は工房の調査サイコロで調べ切れなかった（61–100）後にだけ開く。

ヴェラに、工房にほこりをかぶった注文帳を出してもらい、領主家の紋章で一頁ずつめくってもらう——先ほど留め金を折ってしまったなら、まず謝る。この舵の留め金を注文したその一筆の、支払欄には港の船名簿にない船が書かれている。

これでも工房の糸を留められるが、潮水を余分に一段（十数分）消費する。糸が留まれば、ここにはもう来なくてよい。
