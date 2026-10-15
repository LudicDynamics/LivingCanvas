---
type: gate
name: 세 번째 현장 · 삽화와 거의 일치
title: 세 번째 현장 · 삽화와 거의 일치
bg: assets/backgrounds/scene3.webp
intent: 여기 적힌 기록은 플레이어가 수색하고 주사위를 굴린 뒤에만 존재한다. 그 전에는 절대 보여주거나 이야기하지 않는다.
  pigment-record.md 파일을 근거로 답하고, 군청색의 존재만으로 유죄를 단정하지 않는다. 검시실 기록으로 시간선을 확인하고,
  원고를 본 사람들을 인쇄소로 안내할 수 있다.
choice:
  options:
    - id: search
      label: 여기를 수색한다 (주사위)
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/scene3.webm
choice_actions:
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: spot_hidden
    label: 여기를 수색한다 (주사위)
    title: 구성상의 모순을 간파한다
    body: |-
      너는 이곳을 직접 수색하기로 한다. 아직 아무것도 찾지 못했다 — 단서는 주사위를 굴린 뒤에야 나온다.

      1d100: 낮을수록 좋다. 60 이하면 성공.
      1–12: 대성공. 단서를 찾고 그 핵심에 대해 추가 메모를 남긴다.
      13–60: 성공. 단서와 조사 메모를 얻는다.
      61–95: 실패. 절반만 보인다. 단서 자체가 아니라 무엇이 빠졌는지 적힌 반쪽 단서를 얻고, 시간도 더 쓴다.
      96–100: 대실패. 반쪽 단서만 남고 시간을 크게 잃는다. 너무 서둘러 살피다 다칠 수 있다.

      시계는 정오를 향해 간다. 실패는 한 칸, 대실패는 두 칸의 시간을 쓴다. 놓친 단서가 사건에서 사라지는 것은 아니다. 다른 장소가 진실로 이끌 수도 있다. 각 장소는 한 번만 수색한다. 다시 굴리기는 없다. 주사위가 멈추면, 작가가 수색에서 무엇이 나왔는지 알려준다.
    roll_dice:
      type: 1d100
      desc: 구성상의 모순을 간파한다
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
        text: 핵심만이 아니라 다음에 확인할 단계도 분명하다. 의자와 모자는 같다. 누군가 삽화에 맞춰 현장을 꾸민 듯해 수상하다. 군청색과 오른손
          부상을 화가에게 확인한다. 심문 중 원본을 제시하면 추측과 진술을 분리할 수 있다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record.md
            title: 현장에서 발견된 푸른 물감
            body: |-
              난간에 삽화 물감 튜브 뚜껑과 비슷한 푸른 물감이 묻어 있다. 근처에는 누군가 오른손을 부딪힌 듯한 자국이 있다. 의자와 모자는 소설 삽화와 일치한다.

              삽화를 잘 아는 누군가가 현장을 꾸몄을 수 있다. 인쇄소에서 삽화를 그린 사람이 누구인지 확인하고, 그가 오른손 부상을 입었는지 확인한다.
          - path: world/london-map/third-crime-scene/investigation-great-success.md
            title: 돌파구 메모
            body: 핵심만이 아니라 다음에 확인할 단계도 분명하다. 의자와 모자는 같다. 누군가 삽화에 맞춰 현장을 꾸민 듯해 수상하다. 군청색과 오른손
              부상을 화가에게 확인한다. 심문 중 원본을 제시하면 추측과 진술을 분리할 수 있다.
      - min: 13
        max: 60
        text: 관찰이 연결되었다. 의자와 모자는 같다. 누군가 삽화에 맞춰 현장을 꾸민 듯해 수상하다. 군청색과 오른손 부상을 화가에게 확인한다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record.md
            title: 현장에서 발견된 푸른 물감
            body: |-
              난간에 삽화 물감 튜브 뚜껑과 비슷한 푸른 물감이 묻어 있다. 근처에는 누군가 오른손을 부딪힌 듯한 자국이 있다. 의자와 모자는 소설 삽화와 일치한다.

              삽화를 잘 아는 누군가가 현장을 꾸몄을 수 있다. 인쇄소에서 삽화를 그린 사람이 누구인지 확인하고, 그가 오른손 부상을 입었는지 확인한다.
          - path: world/london-map/third-crime-scene/investigation-success.md
            title: 조사 메모
            body: 관찰이 연결되었다. 의자와 모자는 같다. 누군가 삽화에 맞춰 현장을 꾸민 듯해 수상하다. 군청색과 오른손 부상을 화가에게 확인한다.
      - min: 61
        max: 95
        text: 안개와 구경꾼들. 난간의 푸른 얼룩과 너무 반듯한 의자는 눈에 들어왔지만, 그 푸른색이 무엇이고 누가 남겼는지는 알 수 없다. 수색이
          너무 오래 걸렸다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record-half.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record-half.md
            title: 절반만 본 현장의 푸른 자국
            body: >-
              난간 어딘가에 푸른 얼룩이 있고, 의자도 지나치게 반듯하게 놓여 있다. 하지만 젖은 바닥과 구경꾼 때문에 그 푸른색이
              무엇인지, 여기서 누가 다쳤는지는 알 수 없었다.


              아직 빠진 것: 물감의 정체와 오른손을 부딪힌 자국. 이것 없이는 현장이 누구도 가리키지 않는다.
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 수색하는 소리가 새어 나가, 몰래 살필 기회를 잃었다. 본 것은 푸른 얼룩뿐이다. 난간 반대편을 보려고 몸을 내밀자 젖은 쇠가
          빠지고, 돌계단 아래로 세게 떨어진다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/third-crime-scene/pigment-record-half.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/third-crime-scene/pigment-record-half.md
            title: 절반만 본 현장의 푸른 자국
            body: >-
              난간 어딘가에 푸른 얼룩이 있고, 의자도 지나치게 반듯하게 놓여 있다. 하지만 젖은 바닥과 구경꾼 때문에 그 푸른색이
              무엇인지, 여기서 누가 다쳤는지는 알 수 없었다.


              아직 빠진 것: 물감의 정체와 오른손을 부딪힌 자국. 이것 없이는 현장이 누구도 가리키지 않는다.
            partial: true
        harm: serious
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-hand
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/third-crime-scene.webp
    pins:
      pigment-record:
        - 0.3
        - 0.29
      player:
        - 0.5
        - 0.82
---

의자와 모자는 소설 삽화에 있는 그대로다. 누군가 그림에 맞추어 현장을 일부러 꾸민 듯하다. 푸른 물감과 난간을 친 손자국이 남아 있다.

먼저 현장을 수색한다 — 발견한 것은 주사위를 굴린 뒤에 나온다. 삽화와 사건 중 무엇이 먼저인지는 검시실과 인쇄소에서 확인할 수 있다.
