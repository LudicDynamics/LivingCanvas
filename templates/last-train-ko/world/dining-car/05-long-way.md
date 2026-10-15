---
type: chalk
title: 돌아가기 · 허 영감과 석탄통을 쏟아 보기
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 허 영감에게 부탁해 석탄통을 한 삽씩 비운다 (시간을 한 걸음 더 쓴다)
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: long-way-dining
      on_error: continue
---

이 길은 식당차 수색이 잘 안 된(61–100) 뒤에만 열린다.

허 영감은 자기 석탄통에 무엇이 들었는지 모르지만, 바닥이 더러워진다고 투덜대면서도 한 삽씩 바닥에 쏟는 것을 도와준다. 석탄 밑에 묻혀 있던 것은 빨간 꼬리표가 달린 열쇠다.

열쇠는 똑같이 손에 넣는다. 다만 시간을 한 걸음 더 쓴다. 손에 넣은 뒤에는 다시 올 필요가 없다.
