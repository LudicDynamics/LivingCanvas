---
type: gate
name: 삽화실 · 웨인에게 묻는다
title: 삽화실 · 웨인에게 묻는다
bg: assets/backgrounds/press.webp
intent: 여기서 언급된 기록은 플레이어가 수색하고 주사위를 굴린 뒤에만 존재한다. 그 전에는 절대 보여주거나 이야기하지 않는다.
  visible-details.md 파일과 유통 기록을 질문의 근거로 삼는다. 태도나 부상만으로 유죄를 단정하지 않는다. 보지 못한 증거를 본
  것으로 표시하지 않고, 실제 응답을 기록한다.
choice:
  options:
    - id: search
      label: 여기를 수색한다 (주사위)
    - id: action-1
      label: 웨인에게 손목 부상과 삽화 전달에 대해 묻는다
    - id: action-2
      label: 웨인이 수정된 주소를 읽었는지 확인한다
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/press.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: wayne
  action-2:
    kind: character
    character: wayne
search:
  - id: scene
    skill: psychology
    label: 여기를 수색한다 (주사위)
    title: 화가의 해명을 확인한다
    body: |-
      너는 이곳을 직접 수색하기로 한다. 아직 아무것도 찾지 못했다 — 단서는 주사위를 굴린 뒤에야 나온다.

      1d100: 낮을수록 좋다. 60 이하면 성공.
      1–12: 대성공. 단서를 찾고, 다른 사람들이 놓친 것 하나를 더 찾는다.
      13–60: 성공. 단서와 조사 메모를 찾는다.
      61–95: 실패. 절반만 보인다. 단서 자체가 아니라 무엇이 빠졌는지 적힌 반쪽 단서를 얻고, 시간도 더 쓴다.
      96–100: 대실패. 반쪽 단서만 남고 시간을 크게 잃는다. 누군가 수색하는 것을 눈치챈다.

      시계는 정오를 향해 간다. 실패는 한 칸, 대실패는 두 칸의 시간을 쓴다. 놓친 단서가 사건에서 사라지는 것은 아니다. 다른 장소가 진실로 이끌 수도 있다. 각 장소는 한 번만 수색한다. 다시 굴리기는 없다. 주사위가 멈추면, 작가가 수색에서 무엇이 나왔는지 알려준다.
    roll_dice:
      type: 1d100
      desc: 화가의 해명을 확인한다
      expect: <=60
    choice:
      options:
        - id: back
          label: 주사위를 굴리지 않고 지도로 돌아간다
    choice_actions:
      back:
        kind: enter
        target: world/london-map
    dice_outcomes:
      - min: 1
        max: 12
        text: 핵심뿐 아니라 다음 확인 단계도 분명하다. 오른쪽 손목의 새 붕대, 군청색 소매, 사건 전에 전달된 삽화. 웨인에게 주목할 근거는
          있지만 부상만으로 체포를 정당화할 수는 없다. 심문 중 원본을 제시하면 추측과 진술을 가를 수 있다. 이젤 뒤에는 반송된
          교정지 더미가 놓여 있다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details.md
                - world/london-map/print-shop/illustration-room/returned-proofs.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details.md
            title: 웨인의 부상과 물감 흔적
            body: |-
              오른쪽 손목에 새 붕대가 감겨 있다. 소매에 푸른 물감이 묻어 있다. 변조된 원고가 책상 위에 있다.

              현장에 푸른 물감과 누군가 오른손을 다친 흔적이 있었다. 웨인에게 언제 어디서 다쳤는지 물어보자. 삽화는 사건 전에 도착했으니, 현장을 보고 그렸다고 주장하면 시간선이 맞지 않는다.
            portable: false
          - path: world/london-map/print-shop/illustration-room/returned-proofs.md
            title: 반송된 교정지
            body: |-
              이젤 뒤에는 반송된 교정지 더미가 있고, 그중 하나같이 웨인의 삽화다. 블랙번 편집장의 붉은 연필이 여백을 따라 내려간다. “다음 달부터 연재에 삽화 없음 — 지면을 아껴라.”

              맨 아래 장에는 웨인 자신의 필체로 이렇게 적혀 있다. “두고 보자 — 그림이 글보다 먼저다.”

              이는 그가 왜 사건이 그림을 따라야 했는지 말해 준다. 종이 자체는 범죄의 증거가 아니라, 그를 짓누르는 것일 뿐이다.
      - min: 13
        max: 60
        text: 관찰이 연결되었다. 오른쪽 손목의 새 붕대, 군청색 소매, 사건 전에 전달된 삽화. 웨인에게 주목할 근거는 있지만 부상만으로 체포를
          정당화할 수는 없다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details.md
            title: 웨인의 부상과 물감 흔적
            body: |-
              오른쪽 손목에 새 붕대가 감겨 있다. 소매에 푸른 물감이 묻어 있다. 변조된 원고가 책상 위에 있다.

              현장에 푸른 물감과 누군가 오른손을 다친 흔적이 있었다. 웨인에게 언제 어디서 다쳤는지 물어보자. 삽화는 사건 전에 도착했으니, 현장을 보고 그렸다고 주장하면 시간선이 맞지 않는다.
            portable: false
          - path: world/london-map/print-shop/illustration-room/investigation-success.md
            title: 조사 메모
            body: 관찰이 연결되었다. 오른쪽 손목의 새 붕대, 군청색 소매, 사건 전에 전달된 삽화. 웨인에게 주목할 근거는 있지만 부상만으로 체포를
              정당화할 수는 없다.
      - min: 61
        max: 95
        text: 웨인은 오른팔을 보여 주지 않고 쉬지 않고 말한다. 소매 끝의 얼룩은 언뜻 보였지만, 그에게 따져 물을 만한 것은 없다. 수색이 너무
          오래 걸렸다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details-half.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details-half.md
            title: 언뜻 본 웨인의 소매
            body: |-
              웨인은 오른팔을 이젤 뒤에 감추고 소매도 내린 채다. 소매 끝의 얼룩을 언뜻 보았을 뿐, 그 이상은 알 수 없었다.

              아직 빠진 것: 그의 손목, 얼룩의 색, 그리고 책상 위에 있는 것. 이것 없이는 그에게 내밀 것이 없다.
            partial: true
            portable: false
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 수색하는 소리가 새어 나가, 몰래 살필 기회를 잃었다. 웨인은 책상 위 종이를 엎어 놓고 너와 이젤 사이를 막아선다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/print-shop/illustration-room/visible-details-half.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/illustration-room/visible-details-half.md
            title: 언뜻 본 웨인의 소매
            body: |-
              웨인은 오른팔을 이젤 뒤에 감추고 소매도 내린 채다. 소매 끝의 얼룩을 언뜻 보았을 뿐, 그 이상은 알 수 없었다.

              아직 빠진 것: 그의 손목, 얼룩의 색, 그리고 책상 위에 있는 것. 이것 없이는 그에게 내밀 것이 없다.
            partial: true
            portable: false
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-hand
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/illustration-room.webp
    pins:
      visible-details:
        - 0.39
        - 0.4
      wayne:
        - 0.59
        - 0.44
      player:
        - 0.26
        - 0.86
---

삽화를 그린 웨인의 오른쪽 손목에는 새 붕대가 감겨 있다. 소매에는 푸른 물감이 묻어 있다. 책상 위에는 주소가 바뀐 원고가 놓여 있다.

이 현장과 관련이 있을지 모른다. 부상과 삽화가 전달된 시각에 대해 물어보자. 부상만으로는 죄를 입증할 수 없다.
