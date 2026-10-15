---
type: readme
name: 海滩
bg: assets/scenes/beach.webp
title: 海滩
intent: 凪每天清晨在这儿补网拣鱼；潮线上常冲来漂流木。钓鱼走 command/go-fishing.yaml；捡漂流木送去船坞走
  command/gather-driftwood.yaml（旧渔船进度加一，和健太的交情加深；修满三次由触发器让船下水）；跟凪补网走
  command/mend-nets.yaml。傍晚以后场景换黄昏图。
choice:
  options:
    - id: fish
      label: 在礁石边钓一会儿鱼
    - id: driftwood
      label: 沿潮线捡漂流木，送去船坞
    - id: mend-nets
      label: 坐下来跟凪一起补网
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "fish"
      run: go-fishing
      on_error: continue
    - when: choice.option_id == "driftwood"
      run: gather-driftwood
      on_error: continue
    - when: choice.option_id == "mend-nets"
      run: mend-nets
      on_error: continue
---

白沙滩弯成一道月牙，礁石间的潮池里有小螃蟹横着跑。潮线上躺着几截被海水泡白的木头。

远处，海藻岛和鸟岩在薄雾里若隐若现。
