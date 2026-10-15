---
type: gate
name: 이름 없는 거리 · 지도에 없는 주소
title: 이름 없는 거리 · 지도에 없는 주소
bg: assets/backgrounds/fourth.webp
intent: 여기 적힌 기록은 플레이어가 수색하고 주사위를 굴린 뒤에만 존재한다. 그 전에는 절대 보여주거나 이야기하지 않는다.
  revision-scrap.md 파일은 지도 확인 결과다. meeting-options.md 파일은 알려진 상의 방법이다. 아직 초대장은
  발송되지 않았다. 합의한 계획만 실행한다.
choice:
  options:
    - id: search
      label: 여기를 수색한다 (주사위)
    - id: action-2
      label: 용의자를 안전하게 부르는 방법을 왓슨과 상의한다
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/fourth.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-2:
    kind: character
    character: watson
search:
  - id: scene
    skill: stealth
    label: 여기를 수색한다 (주사위)
    title: 잠복할 장소를 고른다
    body: |-
      너는 이곳을 직접 수색하기로 한다. 아직 아무것도 찾지 못했다 — 단서는 주사위를 굴린 뒤에야 나온다.

      1d100: 낮을수록 좋다. 60 이하면 성공.
      1–12: 대성공. 단서를 찾고, 다른 모두가 놓친 것 하나를 더 찾는다.
      13–60: 성공. 단서와 조사 메모를 찾는다.
      61–95: 실패. 절반만 보인다. 단서 자체가 아니라 무엇이 빠졌는지 적힌 반쪽 단서를 얻고, 시간도 더 쓴다.
      96–100: 대실패. 반쪽 단서만 남고 시간을 크게 잃는다. 너무 서둘러 살피다 다칠 수 있다.

      시계는 정오를 향해 간다. 실패는 한 칸, 대실패는 두 칸의 시간을 쓴다. 놓친 단서가 사건에서 사라지는 것은 아니다. 다른 장소가 진실로 이끌 수도 있다. 각 장소는 한 번만 수색한다. 다시 굴리기는 없다. 주사위가 멈추면, 작가가 수색에서 무엇이 나왔는지 알려준다.
    roll_dice:
      type: 1d100
      desc: 잠복할 장소를 고른다
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
        text: 핵심뿐 아니라 다음에 확인할 단계도 분명하다. 우리는 그 가상의 거리로 갈 수 없다. 실제 안뜰을 이용하고 편집장에게 주소 확인을
          중재해 달라고 부탁할 수 있다. 이디스 본인을 미끼로 쓸 필요는 없다. 원본을 제시하며 심문하면 추측과 진술을 분리할 수
          있다. 모퉁이의 늙은 지도 판매상은 오늘 아침 누가 길을 물었는지 기억하고 있다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap.md
                - world/london-map/unnamed-street/meeting-options.md
                - world/london-map/unnamed-street/asked-the-way.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap.md
            title: 새 주소는 존재하지 않는다
            body: |-
              새 주소는 도시 지도나 주소록에 없다. 그곳으로 가서 기다리려는 계획은 쓸 수 없다.

              대신 인쇄소 안뜰에서 만나 주소를 확인하자고 요청할 수 있다. 누구를 부르고 무엇을 물을지 왓슨과 정한다.
          - path: world/london-map/unnamed-street/meeting-options.md
            title: 안뜰에서의 확인 계획
            body: |-
              편집장에게 “주소를 확인하고 싶다”고 말하게 하고 용의자를 안뜰로 불러 달라고 부탁할 수 있다. 왓슨과 신호와 귀환 경로를 정할 수 있다. 이디스는 221B의 응접실에 머물며 원고 사본만 사용한다.

              아직 아무도 부르지 않았다. 이 계획을 시도하기로 결정하면 용의자의 반응을 확인하고 진행한다.
            portable: false
          - path: world/london-map/unnamed-street/asked-the-way.md
            title: 길을 물은 남자
            body: |-
              모퉁이의 늙은 지도 판매상은 오늘 아침 아홉 시쯤 소매에 푸른 줄이 있는 젊은 남자가 이 거리를 세 번이나 물었고, 오른손은 코트 안에 넣고 있었다고 말한다.

              “런던에 그런 거리는 없다고 했더니, 새파래졌어.”

              8:15 이후, 이디스의 바뀐 주소를 읽은 사람은 단 한 명뿐이었다.
      - min: 13
        max: 60
        text: 관찰이 연결되었다. 우리는 그 가상의 거리로 갈 수 없다. 실제 안뜰을 이용하고 편집장에게 주소 확인을 중재해 달라고 부탁할 수
          있다. 이디스 본인을 미끼로 쓸 필요는 없다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap.md
                - world/london-map/unnamed-street/meeting-options.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap.md
            title: 새 주소는 존재하지 않는다
            body: |-
              새 주소는 도시 지도나 주소록에 없다. 그곳으로 가서 기다리려는 계획은 쓸 수 없다.

              대신 인쇄소 안뜰에서 만나 주소를 확인하자고 요청할 수 있다. 누구를 부르고 무엇을 물을지 왓슨과 정한다.
          - path: world/london-map/unnamed-street/meeting-options.md
            title: 안뜰에서의 확인 계획
            body: |-
              편집장에게 “주소를 확인하고 싶다”고 말하게 하고 용의자를 안뜰로 불러 달라고 부탁할 수 있다. 왓슨과 신호와 귀환 경로를 정할 수 있다. 이디스는 221B의 응접실에 머물며 원고 사본만 사용한다.

              아직 아무도 부르지 않았다. 이 계획을 시도하기로 결정하면 용의자의 반응을 확인하고 진행한다.
            portable: false
          - path: world/london-map/unnamed-street/investigation-success.md
            title: 조사 메모
            body: 관찰이 연결되었다. 우리는 그 가상의 거리로 갈 수 없다. 실제 안뜰을 이용하고 편집장에게 주소 확인을 중재해 달라고 부탁할 수
              있다. 이디스 본인을 미끼로 쓸 필요는 없다.
      - min: 61
        max: 95
        text: 근처를 두 바퀴 돌아도 새 거리는 찾지 못했지만, 확인할 지도와 주소록에는 끝내 손이 닿지 않았다. 수색이 너무 오래 걸렸다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap-half.md
                - world/london-map/unnamed-street/meeting-options.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap-half.md
            title: 아직 찾지 못한 새 거리
            body: |-
              새 주소 근처의 거리를 걸어 보았지만 그 거리는 찾지 못했다. 다만 도시 지도나 주소록을 확인할 시간은 없었다.

              아직 빠진 것: 그 거리가 아예 존재하지 않는다는 증거, 그리고 만남을 실제로 잡을 수 있는 장소.
            partial: true
          - path: world/london-map/unnamed-street/meeting-options.md
            title: 안뜰에서의 확인 계획
            body: >-
              편집장에게 “주소를 확인하고 싶다”고 말하게 하고 용의자를 안뜰로 불러 달라고 부탁할 수 있다. 왓슨과 신호와 귀환
              경로를 정할 수 있다. 이디스는 221B의 응접실에 머물며 원고 사본만 사용한다.


              아직 아무도 부르지 않았다. 이 계획을 시도하기로 결정하면 용의자의 반응을 확인하고 진행한다.
            portable: false
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 수색하는 소리가 새어 나가, 몰래 살필 기회를 잃었다. 아는 것은 거리를 찾지 못했다는 사실뿐이다. 석탄 수레가 골목에서 튀어나온다.
          너무 급히 옆으로 피하다 벽에 부딪힌다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/unnamed-street/revision-scrap-half.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/unnamed-street/revision-scrap-half.md
            title: 아직 찾지 못한 새 거리
            body: |-
              새 주소 근처의 거리를 걸어 보았지만 그 거리는 찾지 못했다. 다만 도시 지도나 주소록을 확인할 시간은 없었다.

              아직 빠진 것: 그 거리가 아예 존재하지 않는다는 증거, 그리고 만남을 실제로 잡을 수 있는 장소.
            partial: true
        harm: light
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-address
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/unnamed-street.webp
    pins:
      revision-scrap:
        - 0.34
        - 0.4
      meeting-options:
        - 0.66
        - 0.42
      player:
        - 0.5
        - 0.82
---

소설에 나온 새 주소는 존재하지 않는다. 그곳에 가서 기다릴 수는 없다. 우리는 지금 인쇄소 안뜰에 있고, 여기서 직접 만나 이야기할 수 있다.

편집장에게 주소 확인을 구실로 용의자를 이곳으로 불러 달라고 부탁할 수 있다. 누구를 부르고 무엇을 확인할지는 왓슨과 상의한다. 위험한 곳으로 이디스를 데려갈 필요는 없다.
