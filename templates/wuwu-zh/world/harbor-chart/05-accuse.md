---
type: chalk
title: 指认 · 把线钉在海图上
status:
  data:
    decoy: "no"
    tunnel: "no"
    ledger: "no"
    wake: "no"
choice:
  options:
    - id: accuse
      label: 在海图上指认：把四条线钉在一起
      when: 'decoy == "yes" && tunnel == "yes" && ledger == "yes" && wake == "yes"'
    - id: not-ready
      label: 对照海图：还差哪条线
      when: 'decoy != "yes" || tunnel != "yes" || ledger != "yes" || wake != "yes"'
on:
  choice_selected:
    - run: accuse
      on_error: continue
---

海图摊在港务所借来的桌上。要揭穿这件事，得把四条线钉在一起：7号码头的船、旧灯塔的十二分钟、工坊的扣件，还有雾里的航迹。

四条线都打上✓，“指认”才会出现。线没钉齐时，可以先对照海图看看还差什么——什么也不会结束，也不耗潮水。指认之后如果没有动静，说明有一件证据不在你包里——把它找回来再指认。

海图上的线（✓ 已钉上，✗ 还差）：
