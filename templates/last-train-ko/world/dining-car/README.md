---
type: gate
name: 4호차 · 식당차
bg: assets/scenes/dining-car.webp
title: 4호차 · 식당차
intent: '제2막의 한 갈래(식당차의 수수께끼: 4번 테이블의 차 두 잔은 누구 것인가, 5호차 열쇠는 어디로 갔나). 요리사 허 영감이
  졸고 있다. NPC 카드 lao-he.md이다(그를 클릭해 "대화"): 그는 11시 넘어 4번 테이블에 노인 한 명과 젊은 여자 한 명이
  있었다는 것, 여자가 노인에게 누렇게 바랜 종이를 보여주었다는 것을 기억한다. 정차 후에는 잠들어 아무것도 보지 못했다. 5호차 열쇠는
  온수기 옆 석탄통에 숨겨져 있으며, 주사위 카드를 통해서만 찾을 수 있다. 수색이 잘 안 되면(61–100) 돌아가기 카드
  05-long-way.md 파일이 열린다(command/miss-dining.yaml). 고르면 시간을 한 걸음 더 쓰고 열쇠가 가방에
  들어온다(command/long-way-dining.yaml).'
choice:
  options:
    - id: take-bill
      label: 4번 테이블의 영수증을 가져간다
    - id: read-teacups
      label: 4번 테이블의 찻잔 두 개를 살펴본다
      once: true
    - id: search
      label: 주사위로 식당차를 수색한다
    - id: talk-laohe
      label: 허 영감과 이야기한다
    - id: ask-cups
      label: 차가 두 잔……다른 한 잔은 누구 거죠?
      to: companion
      say: 차가 두 잔……다른 한 잔은 누가 마신 거죠?
  allow_free: true
choice_actions:
  take-bill:
    kind: take
    paths:
      - world/dining-car/tea-bill.md
  read-teacups:
    kind: read
    paths:
      - world/dining-car/two-teacups.md
  search:
    kind: search
    spot: scene
  talk-laohe:
    kind: talk
    npc: world/dining-car/lao-he.md
search:
  - id: scene
    skill: spot_hidden
    label: 주사위로 식당차를 수색한다
    title: 식당차를 수색한다
    body: >-
      카운터, 식탁, 온수기, 석탄통. 허 영감은 아직 졸고 있다.


      1d100(관찰력 60): 기능 수치 이하면 성공, 낮을수록 좋다.

      96–100(5%): 어둠 속에서 사고가 나 가볍지 않은 부상을 입는다. 단서는 반만 얻고, 시간을 한 걸음 더 쓴다. "돌아가기"가
      열리며, 한 걸음 더 쓰면 열쇠는 손에 넣을 수 있다.

      61–95(35%): 순조롭지 않다. 단서는 반만 얻고, 시간을 한 걸음 더 쓴다. "돌아가기"가 열리며, 한 걸음 더 쓰면 열쇠는
      손에 넣을 수 있다.

      13–60(48%): 성공. 단서를 얻고, 시간을 한 걸음만 쓴다.

      1–12(12%): 대성공. 단서를 얻고, 한 가지를 더 보며, 빨라서 시간을 쓰지 않는다.


      굴릴 때마다 출발에 한 걸음 가까워진다(실패하면 한 걸음 더, 대성공이면 한 걸음 되찾는다). 같은 카드는 한 번만 굴릴 수 있고,
      다시 굴릴 수 없다. 시간을 쓰고 싶지 않으면, 일단 굴리지 말고 열차로 돌아간다.
    roll_dice:
      type: 2d10
      desc: 식당차를 수색한다
      expect: ">=11"
    choice:
      options:
        - id: back
          label: 일단 주사위를 굴리지 않고, 열차로 돌아간다
    choice_actions:
      back:
        kind: enter
        target: map
    dice_outcomes:
      - min: 2
        max: 4
        harm: serious
        text: 먼저 객차 연결부로 더듬어 갔다. 비상등이 거기까지 닿지 않아, 흔들리는 건널판을 넘어 5호차 입구를 보려다 발을 헛디뎌 정강이를
          연결기에 세게 부딪쳤다. 그 소리에 허 영감이 깨어 너를 붙잡고 이것저것 캐묻더니, 카운터를 지나가기도 전에 내쫓아 버렸다.
          나가면서 온수기 옆 석탄통 가장자리의 재가 누군가에게 휘저어져 있는 것이 눈에 들어왔다. 안에 무엇이 있는지는 볼 틈이
          없었다.
        options:
          - id: long-way
            label: "돌아가기: 석탄통을 쏟아 보기"
            action:
              kind: read
              paths:
                - world/dining-car/05-long-way.md
          - id: back
            label: 열차로 돌아가기
            action:
              kind: enter
              target: map
        rewards:
          - path: world/dining-car/freight-key-half.md
            title: 반쪽 단서 · 휘저어진 석탄재
            partial: true
            body: 식당차 온수기 옆 석탄통 가장자리의 재는, 허 영감이 깨기 전에 누군가 휘저어 놓았다. 석탄통 안에 무엇이 있는지는 아직 보지
              못했다.
      - min: 5
        max: 10
        text: 먼저 카운터와 테이블 밑을 뒤지고, 온수기 쪽을 떠올렸을 때는 허 영감이 깨어 직접 석탄을 퍼 넣고 있었다. 그가 가기 전부터 석탄통
          가장자리의 재가 휘저어져 있었다는 것만 알아챘다.
        options:
          - id: long-way
            label: "돌아가기: 석탄통을 쏟아 보기"
            action:
              kind: read
              paths:
                - world/dining-car/05-long-way.md
          - id: back
            label: 열차로 돌아가기
            action:
              kind: enter
              target: map
        rewards:
          - path: world/dining-car/freight-key-half.md
            title: 반쪽 단서 · 휘저어진 석탄재
            partial: true
            body: 식당차 온수기 옆 석탄통 가장자리의 재는, 허 영감이 깨기 전에 누군가 휘저어 놓았다. 석탄통 안에 무엇이 있는지는 아직 보지
              못했다.
      - min: 11
        max: 17
        text: 석탄통 옆의 석탄재는 누군가 헤집어 놓았다. 온수기 옆 석탄통 안, 석탄 덩어리 아래에 "5호차 화물차" 빨간 팻말이 달린 열쇠가
          있다. 누군가 감히 운전실에 다시 걸지 못해 아무렇게나 여기에 던져 둔 것이다.
        options:
          - id: back
            label: 열차로 돌아가기
            action:
              kind: enter
              target: map
          - id: to-freight
            label: 차량 끝 화물차로 간다
            action:
              kind: enter
              target: world/freight-car
        rewards:
          - path: world/dining-car/freight-key.md
            image: assets/items/freight-key.webp
            title: 빨간 팻말이 달린 5호차 열쇠
            body: 식당차 온수기 옆 석탄통에서 찾은 열쇠. 빨간 팻말에 "5호차 화물차"라고 적혀 있다. 누군가 감히 운전실에 다시 걸지 못해 여기에
              던져 두었다. 이것을 가지고 있으면 차량 끝 화물차를 열 수 있다.
      - min: 18
        max: 20
        text: 석탄통 옆의 석탄재는 누군가 헤집어 놓았다. 온수기 옆 석탄통 안, 석탄 덩어리 아래에 "5호차 화물차" 빨간 팻말이 달린 열쇠가
          있다. 누군가 감히 운전실에 다시 걸지 못해 아무렇게나 여기에 던져 둔 것이다. 석탄재 위에는 구두 발자국 반쪽도 남아
          있는데, 옛날식 딱딱한 밑창 구두다. 곧장 석탄통으로 갔다. 이번 수색은 시간을 쓰지 않는다.
        options:
          - id: back
            label: 열차로 돌아가기
            action:
              kind: enter
              target: map
          - id: to-freight
            label: 차량 끝 화물차로 간다
            action:
              kind: enter
              target: world/freight-car
        rewards:
          - path: world/dining-car/freight-key.md
            image: assets/items/freight-key.webp
            title: 빨간 팻말이 달린 5호차 열쇠
            body: 식당차 온수기 옆 석탄통에서 찾은 열쇠. 빨간 팻말에 "5호차 화물차"라고 적혀 있다. 누군가 감히 운전실에 다시 걸지 못해 여기에
              던져 두었다. 이것을 가지고 있으면 차량 끝 화물차를 열 수 있다.
        bonus:
          clock: 1
    on:
      roll_resolved:
        - run: train-step
        - when: roll.rank <= 2
          run: miss-dining
          on_error: continue
map:
  plan:
    picture: assets/maps/dining-car.webp
    pins:
      lao-he:
        - 0.7
        - 0.56
      tea-bill:
        - 0.39
        - 0.4
      two-teacups:
        - 0.42
        - 0.32
      freight-key:
        - 0.88
        - 0.4
      player:
        - 0.5
        - 0.74
view: canvas
---

식당차에는 아직 음식 냄새가 조금 남아 있다. 요리사 허 영감이 카운터에 엎드려 졸고 있고, 온수기가 차량 끝에서 부글부글 끓고 있다.

4번 테이블의 찻잔 두 개가 아직 치워지지 않았고, 테이블 모서리에는 영수증 한 장이 눌려 있다. 그 너머는 잠긴 화물차다.
