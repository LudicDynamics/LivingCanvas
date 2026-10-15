---
type: chalk
title: 2호차 · 경좌차
intent: '제1막(시작 지점). 쑤허의 좌석(17번)과 플레이어의 좌석(18번)이 모두 여기 있다. 흐름: 샤청이 먼저 말을 건다 →
  플레이어가 수첩을 집어 든다 → 주사위로 20번 학생에게 묻는다(증언은 이 한 번의 굴림으로 얻는다. "그와 이야기하러 간다"는 더 이상 기본 선택지가 아니다) → 증언을 얻는다 → 3호차 침대차로, 또는 열차
  지도로 돌아간다(증언을 얻거나 이 칸에서 네 박자를 보내면 선택지 맨 앞에 이 두 출구가 나온다). 학생 저우쯔항(20번)은 NPC 카드 zhou-zihang.md(그를 클릭해 "대화")이며,
  witness-account.md에 적힌 것만 말할 수 있다: 노인의 얼굴은 제대로 보지 못했고, 회색 모직 코트와 희끗한 머리만
  기억한다.'
status:
  data:
    skipped: no
choice:
  options:
    - id: skip-act-one
      label: 학생에게는 서장에서 이미 물어봤다 — 바로 열차 지도로
      for: from-prologue
      when: skipped != "yes"
on:
  choice_selected:
    - when: choice.option_id == "skip-act-one"
      run: prologue-carry
      on_error: continue
---

경좌차 안의 대부분은 잠들어 있고, 누군가는 외투를 둘러싸고 코를 골고 있다. 17번 좌석 위에는 캔버스 가방 하나, 보온병 하나, 그리고 펼쳐진 수첩 한 권이 놓여 있다.

두 좌석 건너의 학생 저우쯔항은 이어폰을 끼고 있고, 내내 자지 않은 듯하다.
