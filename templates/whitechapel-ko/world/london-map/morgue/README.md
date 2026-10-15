---
type: gate
name: 검시실 · 사건은 언제 일어났는가?
title: 검시실 · 사건은 언제 일어났는가?
bg: assets/backgrounds/morgue.webp
intent: 여기 적힌 기록은 플레이어가 수색하고 주사위를 굴린 뒤에만 존재한다. 그 전에는 절대 보여주거나 이야기하지 않는다.
  time-record.md 파일을 인쇄소 영수증과 비교한다. 시간만으로는 특정 인물이 범행을 저질렀다는 증거가 되지 않는다.
choice:
  options:
    - id: search
      label: 여기를 수색한다 (주사위)
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/morgue.webm
choice_actions:
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: library_use
    label: 여기를 수색한다 (주사위)
    title: 삽화와 사건의 선후를 명확히 한다
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
      desc: 삽화와 사건의 선후를 명확히 한다
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
        text: 핵심뿐 아니라 확인해야 할 다음 단계도 분명하다. 배달은 어제 오후 6시, 사건은 다음 날 6시였다. 삽화가 사건보다 앞선다. 현장을
          보고 나서 그렸다는 설명은 맞지 않는다. 심문 중에 원본을 제시하면 추측과 진술을 구분할 수 있다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record.md
            title: 사건 시각 · 오늘 아침 6시
            body: |-
              세 번째 사건은 오늘 아침 6시경에 일어났다.

              삽화의 인쇄소 영수증과 비교해 보자. 삽화가 더 먼저 도착했다면, 누군가 그에 맞춰 사건을 준비했을 수 있다.
          - path: world/london-map/morgue/investigation-great-success.md
            title: 돌파구 메모
            body: 핵심뿐 아니라 확인해야 할 다음 단계도 분명하다. 배달은 어제 오후 6시, 사건은 다음 날 6시였다. 삽화가 사건보다 앞선다. 현장을
              보고 나서 그렸다는 설명은 맞지 않는다. 심문 중에 원본을 제시하면 추측과 진술을 구분할 수 있다.
      - min: 13
        max: 60
        text: 관찰이 연결되었다. 배달은 어제 오후 6시, 사건은 다음 날 6시였다. 삽화가 사건보다 앞선다. 현장을 보고 나서 그렸다는 설명은
          맞지 않는다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record.md
            title: 사건 시각 · 오늘 아침 6시
            body: |-
              세 번째 사건은 오늘 아침 6시경에 일어났다.

              삽화의 인쇄소 영수증과 비교해 보자. 삽화가 더 먼저 도착했다면, 누군가 그에 맞춰 사건을 준비했을 수 있다.
          - path: world/london-map/morgue/investigation-success.md
            title: 조사 메모
            body: 관찰이 연결되었다. 배달은 어제 오후 6시, 사건은 다음 날 6시였다. 삽화가 사건보다 앞선다. 현장을 보고 나서 그렸다는 설명은
              맞지 않는다.
      - min: 61
        max: 95
        text: 대장은 고친 자국투성이다. 세 번째 사건이 오늘 아침이었다는 것은 알지만, 인쇄소 기록과 맞춰 볼 시각은 읽을 수 없다. 수색이 너무
          오래 걸렸다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record-half.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record-half.md
            title: 흐릿한 사건 시각
            body: >-
              시체 안치소 대장에는 세 번째 피해자가 “오늘 이른 아침”에 들어왔다고 적혀 있다. 하지만 정확한 시각은 줄을 긋고
              고쳐 쓴 흔적뿐이다.


              아직 빠진 것: 사건의 정확한 시각. 이것 없이는 삽화 납품 시각과 비교할 수 없다.
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 수색하는 소리가 새어 나가, 몰래 살필 기회를 잃었다. 시각을 읽기도 전에 관리인이 대장을 치워 버린다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/morgue/time-record-half.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/morgue/time-record-half.md
            title: 흐릿한 사건 시각
            body: >-
              시체 안치소 대장에는 세 번째 피해자가 “오늘 이른 아침”에 들어왔다고 적혀 있다. 하지만 정확한 시각은 줄을 긋고
              고쳐 쓴 흔적뿐이다.


              아직 빠진 것: 사건의 정확한 시각. 이것 없이는 삽화 납품 시각과 비교할 수 없다.
            partial: true
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-picture
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/morgue.webp
    pins:
      time-record:
        - 0.83
        - 0.44
      player:
        - 0.26
        - 0.84
---

세 번째 사건은 오늘 아침 6시경에 일어났다.

삽화가 그보다 먼저 그려졌다면, 범행을 목격한 뒤에 만들었다고 말할 수 없다. 인쇄소 기록과 비교해 보자.
