---
type: chalk
title: 돌아가기 · 샤청에게 검표로 그를 불러내 달라고 하기
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 샤청에게 중화이리를 통로로 불러내 검표해 달라 하고, 그 틈에 베개 밑을 본다 (시간을 한 걸음 더 쓴다)
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: long-way-sleeper
      on_error: continue
---

이 길은 객실 수색이 잘 안 된(61–100) 뒤에만 열린다.

샤청에게 부탁해 통로에서 중화이리의 표를 검사하며 최대한 말을 끌게 한다. 객실은 일 분 동안 빈다. 베개를 들추고 약판을 가져간다.

약판은 똑같이 손에 넣는다. 다만 시간을 한 걸음 더 쓴다. 손에 넣은 뒤에는 다시 올 필요가 없다.
