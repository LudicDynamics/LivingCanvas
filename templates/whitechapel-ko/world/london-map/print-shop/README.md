---
type: gate
name: 인쇄소 · 톰에게 묻는다
title: 인쇄소 · 톰에게 묻는다
bg: assets/backgrounds/press.webp
intent: 여기서 언급된 기록은 플레이어가 수색하고 주사위를 굴린 뒤에만 존재한다. 그 전에는 절대 보여주거나 이야기하지 않는다.
  receipt.md 파일과 shift-ledger.md 파일을 보여준다. 톰은 자신의 영수증 기록과 근무 교대에 대해서만 알고 있다.
  편집장과 삽화가는 각각 편집장실과 삽화실에 있다. 아직 대화가 없었다면, 확보한 증언이 있다고 가정하지 않는다.
choice:
  options:
    - id: search
      label: 여기를 수색한다 (주사위)
    - id: action-1
      label: 톰에게 원고와 삽화의 선후에 대해 묻는다
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/press.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: tom
search:
  - id: scene
    skill: spot_hidden
    label: 여기를 수색한다 (주사위)
    title: 원고의 흐름을 파악한다
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
      desc: 원고의 흐름을 파악한다
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
        text: 핵심뿐 아니라 다음 확인 단계도 분명하다. 원고는 편집장에서 화가로 갔고, 삽화는 사건 전에 전달되었다. 사건 전후로 이 작품을 알던
          사람을 구별할 수 있다. 심문 중 원본을 제시하면 추측과 진술을 가를 수 있다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt.md
                - world/london-map/print-shop/shift-ledger.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt.md
            title: 원고와 삽화 수령 기록
            body: |-
              일주일 전: 블랙번 편집장이 이디스의 원고를 받아 화가 웨인에게 주었다.
              어제 오후 6시: 웨인이 세 번째 삽화를 배달했다.
              오늘 6시: 세 번째 사건이 일어났다.
              오늘 8시: 이디스가 네 번째 사건의 주소가 바뀐 원고를 배달했다.

              삽화가 사건보다 먼저 존재했다. 원고를 읽은 사람이 사건을 준비할 수 있었다. 편집장실과 삽화실을 추궁해 보자.
          - path: world/london-map/print-shop/shift-ledger.md
            title: 톰의 근무 기록
            body: |-
              톰은 사건이 일어난 밤에 인쇄소에서 일했다. 그를 교대한 사람의 서명도 기록되어 있다.

              이는 톰의 진술을 뒷받침한다. 그는 원고 전달에 대해서는 알지만 바깥에서 벌어진 범행을 목격하지는 않았다.
            portable: false
          - path: world/london-map/print-shop/investigation-great-success.md
            title: 돌파구 메모
            body: 핵심뿐 아니라 다음 확인 단계도 분명하다. 원고는 편집장에서 화가로 갔고, 삽화는 사건 전에 전달되었다. 사건 전후로 이 작품을 알던
              사람을 구별할 수 있다. 심문 중 원본을 제시하면 추측과 진술을 가를 수 있다.
      - min: 13
        max: 60
        text: 단서들이 연결되었다. 원고는 편집장에서 화가로 넘어갔고, 삽화는 사건 전에 전달되었다. 사건 전과 후에 작품을 알던 사람들을 구분할
          수 있다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt.md
                - world/london-map/print-shop/shift-ledger.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt.md
            title: 원고와 삽화 수령 기록
            body: |-
              일주일 전: 블랙번 편집장이 이디스의 원고를 받아 화가 웨인에게 주었다.
              어제 오후 6시: 웨인이 세 번째 삽화를 배달했다.
              오늘 6시: 세 번째 사건이 일어났다.
              오늘 8시: 이디스가 네 번째 사건의 주소가 바뀐 원고를 배달했다.

              삽화가 사건보다 먼저 존재했다. 원고를 읽은 사람이 사건을 준비할 수 있었다. 편집장실과 삽화실을 추궁해 보자.
          - path: world/london-map/print-shop/shift-ledger.md
            title: 톰의 근무 기록
            body: |-
              톰은 사건이 일어난 밤에 인쇄소에서 일했다. 그를 교대한 사람의 서명도 기록되어 있다.

              이는 톰의 진술을 뒷받침한다. 그는 원고 전달에 대해서는 알지만 바깥에서 벌어진 범행을 목격하지는 않았다.
            portable: false
          - path: world/london-map/print-shop/investigation-success.md
            title: 조사 메모
            body: 단서들이 연결되었다. 원고는 편집장에서 화가로 넘어갔고, 삽화는 사건 전에 전달되었다. 사건 전과 후에 작품을 알던 사람들을 구분할
              수 있다.
      - min: 61
        max: 95
        text: 근무 일지는 두껍고 잉크도 번져 있다. 원고가 편집장에게서 인쇄소의 누군가에게 넘어갔다는 것은 읽었지만, 세 번째 삽화가 언제
          들어왔는지는 알 수 없다. 수색이 너무 오래 걸렸다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt-half.md
                - world/london-map/print-shop/shift-ledger.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt-half.md
            title: 절반만 읽은 수령 기록
            body: >-
              수령 장부는 있다. 하지만 훑어본 쪽에는 일주일 전 블랙번 편집장이 이디스의 원고를 넘겼다는 것만 적혀 있다. 세 번째
              삽화 줄은 잉크가 번졌거나, 미처 넘기지 못한 쪽에 있다.


              아직 빠진 것: 삽화가 인쇄소에 도착한 시각과 사건 시각의 비교. 이것 없이는 그림이 먼저였다고 말할 수 없다.
            partial: true
          - path: world/london-map/print-shop/shift-ledger.md
            title: 톰의 근무 기록
            body: |-
              톰은 사건이 일어난 밤에 인쇄소에서 일했다. 그를 교대한 사람의 서명도 기록되어 있다.

              이는 톰의 진술을 뒷받침한다. 그는 원고 전달에 대해서는 알지만 바깥에서 벌어진 범행을 목격하지는 않았다.
            portable: false
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 수색하는 소리가 새어 나가, 몰래 살필 기회를 잃었다. 건진 것은 근무 일지 한 귀퉁이뿐이다. 높은 선반에서 근무 일지를 끌어내리다가
          옆의 활자 케이스가 넘어져 어깨에 떨어진다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/print-shop/receipt-half.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/print-shop/receipt-half.md
            title: 절반만 읽은 수령 기록
            body: >-
              수령 장부는 있다. 하지만 훑어본 쪽에는 일주일 전 블랙번 편집장이 이디스의 원고를 넘겼다는 것만 적혀 있다. 세 번째
              삽화 줄은 잉크가 번졌거나, 미처 넘기지 못한 쪽에 있다.


              아직 빠진 것: 삽화가 인쇄소에 도착한 시각과 사건 시각의 비교. 이것 없이는 그림이 먼저였다고 말할 수 없다.
            partial: true
        harm: serious
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-picture
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/print-shop.webp
    pins:
      editor-office:
        - 0.14
        - 0.18
      illustration-room:
        - 0.82
        - 0.16
      tom:
        - 0.5
        - 0.3
      receipt:
        - 0.14
        - 0.45
      shift-ledger:
        - 0.74
        - 0.47
      player:
        - 0.5
        - 0.8
---

인쇄공 톰이 작업 기록을 보여줄 것이다. 여기서 “누가 원고를 읽었는가”와 “삽화가 언제 도착했는가”를 확인할 수 있다.

인쇄소의 기록을 수색하거나 톰에게 물어본다. 안쪽 뒤편에는 블랙번 편집장이 사무실에 있고, 웨인은 삽화실에 있다.
