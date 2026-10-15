---
type: gate
name: 편집장실 · 원고를 다음으로 받은 사람은 누구인가?
title: 편집장실 · 원고를 다음으로 받은 사람은 누구인가?
bg: assets/backgrounds/press.webp
intent: 여기서 언급된 기록은 플레이어가 수색하고 주사위를 굴린 뒤에만 존재한다. 그 전에는 절대 보여주거나 이야기하지 않는다.
  correction-log.md 파일을 바탕으로 원고 배포에 대한 책임과 범죄 연루를 구분한다. 환자의 행방을 밝히지 않는다.
choice:
  options:
    - id: search
      label: 여기를 수색한다 (주사위)
    - id: action-1
      label: 수정된 원고가 누구에게 돌아갔는지 묻는다
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/press.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: blackburn
search:
  - id: scene
    skill: library_use
    label: 여기를 수색한다 (주사위)
    title: 주소가 바뀐 원고의 행방을 따라간다
    body: |-
      너는 이곳을 직접 수색하기로 한다. 아직 아무것도 찾지 못했다 — 단서는 주사위를 굴린 뒤에야 나온다.

      1d100: 낮을수록 좋다. 60 이하면 성공.
      1–12: 대성공. 단서를 찾고 그 핵심에 대해 추가 메모를 남긴다.
      13–60: 성공. 단서와 조사 메모를 찾는다.
      61–95: 실패. 절반만 보인다. 단서 자체가 아니라 무엇이 빠졌는지 적힌 반쪽 단서를 얻고, 시간도 더 쓴다.
      96–100: 대실패. 반쪽 단서만 남고 시간을 크게 잃는다. 누군가 수색하는 것을 눈치챈다.

      시계는 정오를 향해 간다. 실패는 한 칸, 대실패는 두 칸의 시간을 쓴다. 놓친 단서가 사건에서 사라지는 것은 아니다. 다른 장소가 진실로 이끌 수도 있다. 각 장소는 한 번만 수색한다. 다시 굴리기는 없다. 주사위가 멈추면, 작가가 수색에서 무엇이 나왔는지 알려준다.
    roll_dice:
      type: 1d100
      desc: 주소가 바뀐 원고의 행방을 따라간다
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
        text: 핵심뿐 아니라 확인해야 할 다음 단계도 분명하다. 편집장은 8시에 받아 8:15에 웨인에게 넘겼다. 수정된 주소는 작가와 편집장만의
          비밀이 아니었다. 심문 중에 원본을 제시하면 추측과 진술을 구분할 수 있다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log.md
            title: 주소가 바뀐 원고의 행방
            body: |-
              오늘 아침 8시: 블랙번이 이디스에게서 원고를 받았다.
              8:15: 그 원고가 웨인에게 넘겨졌고, 웨인은 수령 서명도 했다.

              웨인은 새 주소를 읽을 수 있었다. 삽화실에서 실제로 읽었는지 물어보자. 받기만 한 것으로는 연루를 증명할 수 없다.
          - path: world/london-map/print-shop/editor-office/investigation-great-success.md
            title: 돌파구 메모
            body: 핵심뿐 아니라 확인해야 할 다음 단계도 분명하다. 편집장은 8시에 받아 8:15에 웨인에게 넘겼다. 수정된 주소는 작가와 편집장만의
              비밀이 아니었다. 심문 중에 원본을 제시하면 추측과 진술을 구분할 수 있다.
      - min: 13
        max: 60
        text: 관찰이 연결되었다. 편집장은 8시에 받아 8:15에 웨인에게 넘겼다. 수정된 주소는 작가와 편집장만의 비밀이 아니었다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log.md
            title: 주소가 바뀐 원고의 행방
            body: |-
              오늘 아침 8시: 블랙번이 이디스에게서 원고를 받았다.
              8:15: 그 원고가 웨인에게 넘겨졌고, 웨인은 수령 서명도 했다.

              웨인은 새 주소를 읽을 수 있었다. 삽화실에서 실제로 읽었는지 물어보자. 받기만 한 것으로는 연루를 증명할 수 없다.
          - path: world/london-map/print-shop/editor-office/investigation-success.md
            title: 조사 메모
            body: 관찰이 연결되었다. 편집장은 8시에 받아 8:15에 웨인에게 넘겼다. 수정된 주소는 작가와 편집장만의 비밀이 아니었다.
      - min: 61
        max: 95
        text: 블랙번이 책상 곁을 떠나지 않는다. 고친 원고가 아침 8시에 도착했다는 것은 읽었지만, 다음에 어디로 갔는지는 알 수 없다. 수색이
          너무 오래 걸렸다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log-half.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log-half.md
            title: 절반만 읽은 회람 기록
            body: >-
              블랙번의 회람 기록에는 이디스가 고친 원고가 아침 8시에 도착했다고 적혀 있다. 그다음 줄, 원고가 어디로 갔는지는
              압지 밑에 있었고 들춰 보게 해 주지 않았다.


              아직 빠진 것: 8시 이후 원고를 받은 사람과 그 서명.
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 수색하는 소리가 새어 나가, 몰래 살필 기회를 잃었다. 블랙번은 기록부를 덮고 자기 서류에서 손을 떼 달라고 차갑게 말한다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/print-shop/editor-office/correction-log-half.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/editor-office/correction-log-half.md
            title: 절반만 읽은 회람 기록
            body: >-
              블랙번의 회람 기록에는 이디스가 고친 원고가 아침 8시에 도착했다고 적혀 있다. 그다음 줄, 원고가 어디로 갔는지는
              압지 밑에 있었고 들춰 보게 해 주지 않았다.


              아직 빠진 것: 8시 이후 원고를 받은 사람과 그 서명.
            partial: true
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-address
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/editor-office.webp
    pins:
      correction-log:
        - 0.5
        - 0.42
      blackburn:
        - 0.73
        - 0.27
      player:
        - 0.27
        - 0.8
---

블랙번 편집장이 원고를 관리한다. 오늘 아침, 이디스가 수정한 원고를 받았다.

그 원고를 다음으로 누구에게 넘겼는가? 책상을 수색하거나 블랙번에게 직접 물어본다.
