---
type: readme
name: 당신의 밭
bg: assets/scenes/farm.webp
title: 당신의 밭
intent: 당신이 물려받은 밭. 옆은 렌의 밭이다. 밭 돌보기는 command/tend-farm.yaml(world/README.md의
  farm_growth가 하나 오른다. "거둘 때가 됐다"가 되면 트리거가 수확하고, 첫 수확엔 player/first-turnip.md 파일을
  얻는다). 렌 돕기는 command/help-ren.yaml. 배경은 계절에 따라 바뀌니(엔진의 변형 그림) 다른 계절로 묘사하지 마라.
choice:
  options:
    - id: tend
      label: 흙을 갈고 물을 주며 밭을 돌본다
    - id: help-ren
      label: 옆집 렌을 잠시 돕는다
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "tend"
      run: tend-farm
      on_error: continue
    - when: choice.option_id == "help-ren"
      run: help-ren
      on_error: continue
---

볕 잘 드는 비탈을 낮은 돌담이 두르고, 담 밑엔 잡초가 무성하다. 낡은 농기구가 창고에 기대 있고, 괭이 자루는 손때로 검어졌다.

옆 렌의 밭은 이랑이 반듯하게 줄지어, 마치 시범을 보여 주는 것 같다.
