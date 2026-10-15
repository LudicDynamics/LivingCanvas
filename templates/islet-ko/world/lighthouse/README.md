---
type: readme
name: 등대
bg: assets/scenes/lighthouse.webp
title: 등대
intent: 스즈 할머니의 영역. 그녀의 날씨 읽기는 틀리지 않는다. 컨텍스트의 "내일 날씨"는 그녀만 입에 올릴 수 있고, 하늘을 읽는
  말(구름, 바람, 바닷새)로만 한다. 숫자로 말하지 않는다. 등대에 올라 곁에 있기는 command/visit-lighthouse.yaml.
  겨울 마지막 날의 해넘이 차는 여기서 열린다.
choice:
  options:
    - id: climb
      label: 등대에 올라 스즈 할머니와 하늘을 본다
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "climb"
      run: visit-lighthouse
      on_error: continue
---

하얀 등대가 섬에서 가장 높은 곶에 서 있고, 나선 계단이 빙글빙글 위로 이어진다. 등실의 유리는 티 하나 없고, 망원경이 서쪽 바다를 향한다.

탑 아래 작은 방엔 낡은 탁상시계와 수십 년의 날씨를 적은 공책이 있다.
