---
type: chalk
title: "让夏澄去驾驶室发电报"
intent: "第三幕的收束捷径：玩家不必自己走回1车，夏澄跑去驾驶室用电台报告，引擎跑和 world/cab/02-radio-report.md 同一条 command/report-truth.yaml：证据齐了才 end found；不齐就 tick -1。作家不要替引擎宣布结局；证据不齐时由夏澄带回调度的追问（人在哪、凭什么说是他），只指方向，不列清单。"
choice:
  options:
    - id: relay
      label: "让夏澄去驾驶室，用电台向岭口调度报告"
on:
  choice_selected:
    - when: 'choice.option_id == "relay"'
      run: report-truth
---

夏澄把手电塞给你：“我跑得快。你守着她，我去驾驶室叫岭口调度。”

调度只信证据：人在哪里？是谁？凭什么这么说？证据不够就打过去，只会白白耗掉一步时间；手里的东西没变，再打一次，调度也只会给同一个回答。
