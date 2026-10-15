---
type: gate
name: 221B 응접실 · 작가와의 대화
title: 221B 응접실 · 작가와의 대화
bg: assets/backgrounds/intro.webp
intent: 여기 적힌 기록은 플레이어가 수색하고 주사위를 굴린 뒤에만 존재한다. 그 전에는 절대 보여주거나 이야기하지 않는다. 이디스의
  의심과 확인된 사실을 address-correction.md 파일을 근거로 구분한다. 보호 대상에게는 자신의 의지가 있다. 그 사람을 미끼로
  보내려는 가짜 동의를 만들지 않는다.
choice:
  options:
    - id: search
      label: 여기를 수색한다 (주사위)
    - id: action-1
      label: 주소를 왜 바꿨는지 묻는다
    - id: action-2
      label: 수정 원고를 누구에게 줬는지 묻는다
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/intro.webm
choice_actions:
  search:
    kind: search
    spot: scene
  action-1:
    kind: character
    character: edith
  action-2:
    kind: character
    character: edith
search:
  - id: scene
    skill: psychology
    label: 여기를 수색한다 (주사위)
    title: 가상 주소의 의미를 해독한다
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
      desc: 가상 주소의 의미를 해독한다
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
        text: 핵심뿐 아니라 다음에 확인할 단계도 분명하다. 이디스는 가상 주소로 반응을 시험했다. 누군가를 그곳으로 유인할 계획은 아니다.
          수정본을 받은 사람을 뒤따른다. 심문할 때 원문을 제시하면 추측과 증언을 구분하는 데 도움이 된다. 이디스의 원고 사본에도
          그녀가 연필로 적은 메모가 있다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction.md
                - world/london-map/edith-room/margin-note.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction.md
            title: 이디스가 주소를 바꾼 이유
            body: |-
              오늘 아침, 이디스는 소설의 주소를 존재하지 않는 거리로 바꿔 편집장에게 건넸다.

              “누군가 그곳에 가려 하면, 그런 거리가 없다는 걸 알게 되겠죠. 누가 곤란해하는지 알아내서 물어보고 싶었어요.”

              이것이 그녀가 조사를 위해 떠올린 방법이다. 아직 범인을 찾은 것은 아니다. 편집부 기록에서 그 원고를 다음에 누가 읽었는지 확인할 수 있다.
          - path: world/london-map/edith-room/margin-note.md
            title: 여백의 한 줄
            body: |-
              이디스 사본의 세 번째 장 여백에, 그녀의 연필 글씨로: “모자? 나는 모자를 쓴 적이 없어. 그리고 의자는 창가에 있지 않아.”

              세 번째 현장의 모자와 의자는 삽화와 정확히 일치하지만, 그녀의 소설에는 없다. 그 장면을 꾸민 자는 글자가 아니라 그림을 보고 있었다.
      - min: 13
        max: 60
        text: 관찰이 이어졌다. 이디스는 가상 주소로 반응을 시험했다. 누군가를 그곳으로 유인할 계획은 아니다. 수정된 주소를 받은 사람을
          뒤따른다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction.md
            title: 이디스가 주소를 바꾼 이유
            body: |-
              오늘 아침, 이디스는 소설의 주소를 존재하지 않는 거리로 바꿔 편집장에게 건넸다.

              “누군가 그곳에 가려 하면, 그런 거리가 없다는 걸 알게 되겠죠. 누가 곤란해하는지 알아내서 물어보고 싶었어요.”

              이것이 그녀가 조사를 위해 떠올린 방법이다. 아직 범인을 찾은 것은 아니다. 편집부 기록에서 그 원고를 다음에 누가 읽었는지 확인할 수 있다.
          - path: world/london-map/edith-room/investigation-success.md
            title: 조사 메모
            body: 관찰이 이어졌다. 이디스는 가상 주소로 반응을 시험했다. 누군가를 그곳으로 유인할 계획은 아니다. 수정된 주소를 받은 사람을
              뒤따른다.
      - min: 61
        max: 95
        text: 4장의 주소가 바뀐 것은 알았지만 이유는 모른다. 이디스는 아직 겁에 질려 설명하지 못한다. 수색이 너무 오래 걸렸다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction-half.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction-half.md
            title: 이유를 모르는 주소 변경
            body: >-
              이디스의 초고에는 4장의 주소가 줄로 지워지고 다른 거리로 바뀌어 있다. 왜 바꿨는지는 원고에 없고, 그녀도 너무 놀라
              말하지 못했다.


              아직 빠진 것: 그녀의 이유. 이것 없이는 새 주소가 그저 오탈자 수정처럼 보인다.
            partial: true
        cost:
          clock: -1
      - min: 96
        max: 100
        text: 수색하는 소리가 새어 나가, 몰래 살필 기회를 잃었다. 이디스는 원고를 거둬 가고 당분간 다시 보여 주지 않으려 한다.
        options:
          - id: read-clue
            label: 단서를 읽는다
            action:
              kind: read
              paths:
                - world/london-map/edith-room/address-correction-half.md
          - id: back
            label: 지도로 돌아간다
            action:
              kind: enter
              target: world/london-map
        rewards:
          - path: world/london-map/edith-room/address-correction-half.md
            title: 이유를 모르는 주소 변경
            body: >-
              이디스의 초고에는 4장의 주소가 줄로 지워지고 다른 거리로 바뀌어 있다. 왜 바꿨는지는 원고에 없고, 그녀도 너무 놀라
              말하지 못했다.


              아직 빠진 것: 그녀의 이유. 이것 없이는 새 주소가 그저 오탈자 수정처럼 보인다.
            partial: true
        cost:
          clock: -2
    on:
      roll_resolved:
        - run: mark-address
          when: roll.rank >= 3
map:
  plan:
    picture: assets/maps/edith-room.webp
    pins:
      address-correction:
        - 0.36
        - 0.38
      edith:
        - 0.78
        - 0.53
      player:
        - 0.47
        - 0.85
---

소설가 이디스는 여기서 왓슨의 보호를 받는다. “소설은 내가 썼지만, 누군가를 다치게 할 생각은 없었어요.”

그녀는 오늘 아침 소설의 주소를 바꿨다. 왜 바꿨는지, 누구에게 줬는지 묻는다.
