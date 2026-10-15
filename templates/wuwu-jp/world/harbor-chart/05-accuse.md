---
type: chalk
title: 告発・糸を海図に留める
status:
  data:
    decoy: no
    tunnel: no
    ledger: no
    wake: no
choice:
  options:
    - id: accuse
      label: 海図の上で告発する：四本の糸を一つに留める
      when: decoy == "yes" && tunnel == "yes" && ledger == "yes" && wake == "yes"
    - id: not-ready
      label: 海図と照合する：まだ足りない糸はどれか
      when: decoy != "yes" || tunnel != "yes" || ledger != "yes" || wake != "yes"
on:
  choice_selected:
    - run: accuse
      on_error: continue
---

海図は港務所から借りた机の上に広げられている。これを暴くには、四本の糸を一つに留めねばならない：7番埠頭の船、古い灯台の十二分、工房の留め金、そして霧の中の航跡だ。

四本の糸すべてに✓がつくと、「告発」が現れる。糸が揃っていないときは、海図と照合して何が足りないか見てよい——何も終わらず、潮位も消費しない。告発しても反応がないなら、証拠の一つが鞄に入っていない証拠だ——それを取り戻してから告発しよう。

海図上の糸（✓ 留め済み、✗ 未達）：
