---
type: readme
name: 하나의 잡화점
bg: assets/scenes/store.webp
title: 하나의 잡화점
intent: 섬의 유일한 가게. 뭐든 조금씩 팔고, 섬사람들의 생선과 채소도 맡아 판다. 소식은 하나에게 가장 먼저 닿는다. 하나에게 생선
  맡기기는 command/sell-fish.yaml(바구니가 비고 하나와 친해진다). 비 오는 날엔 겐타와 렌이 비를 피하러 온다.
choice:
  options:
    - id: sell-fish
      label: 바구니의 생선을 하나에게 맡겨 판다
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "sell-fish"
      run: sell-fish
      on_error: continue
---

문종이 딸랑 울린다. 바닥부터 천장까지 선반이 이어진다 — 통조림, 씨앗, 밧줄, 손전등, 매실 절임 병. 계산대 옆엔 글씨로 빽빽한 장부가 펼쳐져 있다.

카운터 뒤엔 언제나 뜨거운 차 한 주전자가 있다.
