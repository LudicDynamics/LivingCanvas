---
type: chalk
title: '正午之前'
status:
  data:
    left: 10
    arrived: "no"
    picture: "no"
    hand: "no"
    address: "no"
choice:
  options:
    - id: confront
      label: '当面摊牌：把“画在事件之前”和“他的手在现场”的证据摆在他面前'
      when: 'arrived == "yes" && picture == "yes" && hand == "yes"'
    - id: trap
      label: '将计就计：收下红信封，约他正午到印刷所中庭“亲手交给伊迪丝”，在那里等他'
      when: 'arrived == "yes" && address == "yes"'
    - id: edith-first
      label: '先顾伊迪丝：让华生带她从221B后门离开'
      when: 'arrived == "yes"'
    - id: follow-him
      label: '装作没起疑，放他走，再悄悄跟上去'
      when: 'arrived == "yes"'
intent: '这张卡是正午前的压力。韦恩找上门之前（arrived 为 no），它只提醒时间，不要让任何人出题、提交推理或填写文件。玩家查实的事够多时，引擎让韦恩本人拦住福尔摩斯（command/wayne-turns-up.yaml）：演他客气、固执、夹着红信封不肯走，一心要亲手把第四幅画的校样交给伊迪丝；华生催福尔摩斯立刻决定，伊迪丝想亲自面对他。能选哪几条路，取决于玩家实际查到了什么。卡上的决定由引擎执行（command/confront-wayne.yaml、set-trap.yaml、edith-first.yaml、follow-wayne.yaml）；作家不要用叙述宣布结局，也不要替玩家做决定。'
on:
  choice_selected:
    - run: confront-wayne
      when: 'choice.option_id == "confront"'
    - run: set-trap
      when: 'choice.option_id == "trap"'
    - run: edith-first
      when: 'choice.option_id == "edith-first"'
    - run: follow-wayne
      when: 'choice.option_id == "follow-him"'
---

离正午还有两个钟头。搜查不顺会耗掉上午的时间；要是正午先到，第四幅画就会成真。

不用猜，也不用写什么推理：去现场、验尸室、印刷所和客厅里亲手查。等你查实的事够多，那个把小说变成真事的人会坐不住，自己找上门来。到那时，你手里握着什么，决定了你能怎么做。
