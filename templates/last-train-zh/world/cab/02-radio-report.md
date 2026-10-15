---
type: chalk
title: "电台 · 向岭口调度报告"
intent: "唯一的收束点。玩家选“报告”时，引擎跑 command/report-truth.yaml：证据齐了才 end found；不齐就 tick -1。作家不要替引擎宣布结局，也不要在证据不齐时让调度“相信”。证据不齐时，由调度追问缺的那一环（人在哪、凭什么说是他），只指方向，不列清单。"
choice:
  options:
    - id: report
      label: "报告：苏禾被钟怀礼锁进了行李车"
on:
  choice_selected:
    - when: 'choice.option_id == "report"'
      run: report-truth
---

电台那头是岭口调度，声音被隧道压得很远。调度会问三件事：人在哪里？是谁？凭什么这么说？

只有找到了苏禾本人，又拿得出能把钟怀礼和这件事连在一起的东西，这通电话才算数。证据不够就打过去，只会白白耗掉一步时间；手里的东西没变，再打一次，调度也只会给同一个回答。
