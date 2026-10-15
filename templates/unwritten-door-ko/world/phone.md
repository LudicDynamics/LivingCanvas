---
type: note
title: 전화기
visual: phone
portable: true
choice:
  options:
    - id: action-1
      label: 화면을 깨운다
    - id: action-2
      label: 마지막 번호로 전화한다
status:
  data:
    contacted: false
intent: 화면 검사는 제한된 정보를 드러낸다. 허구적 통화는 실제 단어, 구체적으로 들리는 세부 사항 하나, 공개 맥락, contacted=true를 기록한다. 실제 전화 통화가 아니다.
choice_actions:
  action-1:
    kind: writer
  action-2:
    kind: writer
---

검은 전화기가 뒤집힌 채 놓여 있다.

## 맥락
아직 정보가 발견되지 않았다.
