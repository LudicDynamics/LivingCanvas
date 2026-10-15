---
type: chalk
title: 돌아가기 · 물자국을 따라 물가를 걷기
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 물가를 따라 물자국을 쫓아 걷기 (조수 한 구간 더 소모)
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: evidence-wake
      on_error: continue
    - when: choice.option_id == "long-way"
      run: long-way-chart
      on_error: continue
---

이 길은 해도 위의 결정적 판정을 제대로 못 본 뒤(61–95, 또는 96–100에서 등불을 켜 버틴 경우)에만 열린다.

가장 바깥쪽 디딤돌에 버티고 서서 억지로 보는 대신, 물가를 따라 물자국을 쫓아 옛 세관 터널 입구 밖까지 걸어간다. 느리지만 한 걸음 한 걸음이 확실하다: 그 항적은 터널 입구에서 나와 무인선을 스치듯 지나, 다시 안개 속으로 꺾여 들어간다.

이렇게 해도 해도 위의 실마리를 못 박을 수 있다, 다만 조수 한 구간(십몇 분)을 더 쓴다. 실마리를 못 박은 뒤에는 여기 다시 올 필요가 없다.
