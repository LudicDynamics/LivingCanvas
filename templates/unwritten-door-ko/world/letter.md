---
type: letter
title: 봉인된 봉투
visual: envelope
portable: true
choice:
  options:
    - id: action-1
      label: 봉투를 연다
    - id: action-2
      label: 바깥을 살핀다
status:
  data:
    opened: false
intent: 열어야만 짧고 구체적인 메시지가 드러난다. 전체 메시지, 공개 맥락, opened=true를 유지한다. 바깥을 보는 것은 여는 것이 아니다. 다시 방문해도 같은 텍스트를 유지한다.
choice_actions:
  action-1:
    kind: writer
  action-2:
    kind: reply
    text: 봉투의 필체는 낯설다. 봉인은 온전하다. 바깥을 보는 것은 봉투를 열거나 이름을 드러내지 않았다.
---

낯선 필체로 주소가 쓰인 봉투.

## 맥락
편지는 열리지 않았다.
