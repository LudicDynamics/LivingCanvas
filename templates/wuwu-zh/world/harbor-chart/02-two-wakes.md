---
type: chalk
title: 寻找另一艘船
choice:
  options:
    - id: action-1
      label: 问薇拉：这些线说明什么
    - id: action-2
      label: 还要再调查
  allow_free: true
intent: 这里不填表、不提交。玩家想理一理时，由薇拉用自己的口吻聊：玩家包里真有的证据、它们说明什么、下一处该去哪张骰卡。只聊天，不发放证据、不新建判定卡、不生成新地点、不宣布结局。证据只来自各地的调查骰；揭穿只在 world/harbor-chart/05-accuse.md 由引擎判定。
choice_actions:
  action-1:
    kind: character
    character: vera
  action-2:
    kind: enter
    target: world/harbor-chart
---

船上的伤痕，和灯塔熄灭的时间。把两者合起来看，雾中可能还有另一艘船。

想理一理的话，问问薇拉——说话不耗潮水，也不用掷骰。真正把线钉上海图的，是各地的调查骰和海图上的决定性判定；没掷中的线，要去那里的“绕远路”补上。
