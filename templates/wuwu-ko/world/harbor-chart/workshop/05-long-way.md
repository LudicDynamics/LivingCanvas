---
type: chalk
title: 돌아가기 · 베라에게 주문 장부를 뒤져 달라 청하기
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 베라에게 공방의 주문 장부를 뒤져 달라 청하기(조수 한 구간 더 소모)
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: evidence-ledger
      on_error: continue
    - when: choice.option_id == "long-way"
      run: long-way-workshop
      on_error: continue
---

이 길은 공방의 조사 주사위가 다 살피지 못했을 때(61–100)에만 열린다.

베라에게 먼지 쌓인 공방 주문 장부를 꺼내 오게 하고, 영주 문장을 따라 한 장씩 넘겨 보게 한다—방금 고정쇠를 부러뜨렸다면 먼저 사과부터 하자. 이 키 고정쇠를 주문한 항목의 지급란에는 항구 선박 명부에 없는 배가 적혀 있다.

이렇게 해도 공방의 실마리를 못 박을 수 있다. 다만 조수가 한 구간(십몇 분) 더 든다. 실마리를 못 박고 나면 여기에는 다시 올 필요가 없다.
