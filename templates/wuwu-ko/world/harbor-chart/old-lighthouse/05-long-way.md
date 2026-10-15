---
type: chalk
title: 돌아가기 · 모 영감에게 일지를 일 분씩 대조해 달라 청하기
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 모 영감에게 일지와 조석표를 일 분씩 대조해 달라 청하기 (조수 한 구간 더 소모)
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: evidence-tunnel
      on_error: continue
    - when: choice.option_id == "long-way"
      run: long-way-lighthouse
      on_error: continue
---

이 길은 옛 등대의 조사 주사위를 다 못 굴린 뒤(61–100)에만 열린다.

모 영감에게 부탁하라: 일지를 펼쳐 오늘 밤 조석표와 일 분씩 대조해 달라고—방금 그의 망원경을 떨어뜨렸다면 먼저 제대로 사과하라. 불이 꺼진 그 십이 분은, 터널 입구가 수면 위로 드러나는 구간과 일 분도 틀리지 않고 겹친다.

이렇게 해도 옛 등대의 실마리를 못 박을 수 있다, 다만 조수 한 구간(십몇 분)을 더 쓴다. 실마리를 못 박은 뒤에는 여기 다시 올 필요가 없다.
