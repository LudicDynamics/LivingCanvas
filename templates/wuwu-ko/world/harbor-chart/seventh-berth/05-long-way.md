---
type: chalk
title: 돌아가기 · 은솔개에게 직접 화물칸을 열어 달라 청하기
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 은솔개에게 직접 화물칸을 열어 달라 청하고 함께 검사한다 (조수 한 구간 더 소모)
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: evidence-decoy
      on_error: continue
    - when: choice.option_id == "long-way"
      run: long-way-berth
      on_error: continue
---

이 길은 7번 부두의 조사 주사위가 다 살펴지지 않았을 때(61–100)만 열린다.

정면으로 은솔개를 찾아간다. 긁힌 자국 기록을 내밀고 왜 화물칸을 봐야 하는지 설명한다. 방금 그에게 들켰다면 먼저 말을 꺼내 둔다. 그는 대신 결론을 내려 주지는 않지만, 네 앞에서 직접 뚜껑을 열어 준다. 밸러스트 돌, 못 박힌 빈 상자.

이렇게 해도 7번 부두의 실마리를 못 박을 수 있다. 다만 조수가 한 구간(십몇 분) 더 든다. 실마리를 못 박고 나면 여기에는 다시 올 필요가 없다.
