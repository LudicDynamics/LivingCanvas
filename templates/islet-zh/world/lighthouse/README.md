---
type: readme
name: 灯塔
bg: assets/scenes/lighthouse.webp
title: 灯塔
intent: 鈴婆婆的地盘。她看天看得准：注入里的「明天的天气」只有她能说出口，而且要用看天的话说（云脚、风向、海鸟），不要报数字。爬上灯塔陪她走
  command/visit-lighthouse.yaml。冬季最后一天的守岁茶在这里。
choice:
  options:
    - id: climb
      label: 爬上灯塔，陪鈴婆婆看一会儿天
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "climb"
      run: visit-lighthouse
      on_error: continue
---

白色的灯塔立在岛最高的岬角上，螺旋楼梯一圈圈往上。塔顶的玻璃擦得一尘不染，望远镜对着西边的海。

塔底的小屋里有一只老座钟，还有一本记了几十年天气的本子。
