---
type: chalk
title: 그 마법은 무엇을 바꾸나?
choice:
  options:
    - id: action-1
      label: 마법 조합을 적는다
    - id: action-2
      label: 제안한 마법의 대가를 확인한다
  allow_free: true
  free_hint: 동사, 아이템, 원하는 변화, 감당할 대가를 네 말로 적는다.
intent: 실제 제안을 player/spell-draft.md.에 저장한다. 합리적인 결과와 구체적인 대가를 미리 제시하고, 이름 붙이기, 시전, 수정, 중단 중 하나를 기다린다.
choice_actions:
  action-1:
    kind: writer
  action-2:
    kind: stage
    slots:
      - id: material-1
        title: 마법과 대가 제안
        required: true
        paths:
          - player/spell-draft.md
---

성공이란 큰 문을 여는 것만이 아니다. 주머니 크기의 별지도를 만드는 것도 너의 마법이 될 수 있다.
