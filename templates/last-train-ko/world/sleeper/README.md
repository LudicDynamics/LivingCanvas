---
type: gate
name: 3호차 · 침대차
bg: assets/scenes/sleeper.webp
title: 3호차 · 침대차
intent: "제2막의 한 갈래(침대차의 수수께끼: 회색 모직 코트는 누구의 것인가, 그는 정말 잠들어 있었나). 중화이리는 3번 객실 하단
  침대에 있다. 그는 등록된 역할로, 11시 30분에 약을 먹고 잤다고 거짓말한다; 오직 면전에서 실물을 내밀었을 때만 입을 열며, 일지
  페이지의 행방은 절대 먼저 내놓지 않는다. 그의 객실을 수색하는 것은 주사위 카드로 진행하고, 서술로 약판을 직접 제시하지 않는다. 수색이
  잘 안 되면(61–100) 돌아가기 카드 05-long-way.md 파일이 열린다(command/miss-sleeper.yaml). 고르면
  시간을 한 걸음 더 쓰고 약판이 가방에 들어온다(command/long-way-sleeper.yaml)."
choice:
  options:
    - id: read-coat
      label: 3번 객실 문 앞에 걸린 코트를 본다
      once: true
    - id: search
      label: 주사위를 굴려 3번 객실을 수색한다
    - id: talk
      label: 문을 두드리고 중화이리와 이야기한다
      to: writer
    - id: ask-sleep
      label: 열한 시 반에 벌써 주무셨다고요?
      to: zhong-huaili
      say: 중 선생님, 정말 열한 시 반에 벌써 주무셨어요?
    - id: ask-coat
      label: 문 앞의 코트, 선생님 거죠?
      to: zhong-huaili
      say: 문 앞에 걸린 회색 모직 코트, 선생님 거죠?
  allow_free: true
choice_actions:
  read-coat:
    kind: read
    paths:
      - world/sleeper/grey-coat.md
  search:
    kind: search
    spot: scene
  talk:
    kind: character
    character: zhong-huaili
search:
  - id: scene
    skill: stealth
    label: 주사위를 굴려 3번 객실을 수색한다
    title: 3번 객실을 수색한다
    body: >-
      중화이리는 문을 등지고 누워 있다. 너는 그를 깨우지 않고 그의 침대를 살펴봐야 한다.


      1d100(은밀행동 60): 기능 수치 이하면 성공, 낮을수록 좋다.

      96–100(5%): 그가 깼다. 단서는 반만 얻고, 시간을 두 걸음 더 쓴다. "돌아가기"가 열리며, 한 걸음 더 쓰면 약판은 손에
      넣을 수 있다.

      61–95(35%): 매끄럽지 않았다. 단서는 반만 얻고, 시간을 한 걸음 더 쓴다. "돌아가기"가 열리며, 한 걸음 더 쓰면 약판은
      손에 넣을 수 있다.

      13–60(48%): 성공. 단서를 얻고, 시간을 한 걸음만 쓴다.

      1–12(12%): 대성공. 단서를 얻고, 한 가지를 더 보며, 빨라서 시간을 쓰지 않는다.


      굴릴 때마다 출발에 한 걸음 가까워진다(실패하면 한 걸음 더, 대성공이면 한 걸음 되찾는다). 같은 카드는 한 번만 굴릴 수 있고,
      다시 굴릴 수 없다. 시간을 쓰고 싶지 않으면, 일단 굴리지 말고 열차로 돌아간다.
    roll_dice:
      type: 2d10
      desc: 3번 객실을 수색한다
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
        text: 그가 깼다. 중화이리가 일어나 앉아 베개 위에 손을 얹은 채, 네가 객실에서 물러날 때까지 말없이 바라본다. 그러고는 호출 버튼을
          눌러 "낯선 사람이 내 짐을 뒤졌다"며 샤청과 너를 통로에 한참 붙잡아 두었다. 네가 본 것은 베개 밑으로 삐져나온 은박
          약판의 모서리뿐이다. 그는 이미 네가 자신을 조사하고 있다는 것을 알고 있다.
        options:
          - id: long-way
            label: "돌아가기: 샤청에게 그를 불러내 달라고 하기"
            action:
              kind: read
              paths:
                - world/sleeper/05-long-way.md
          - id: back
            label: 열차로 돌아가기
            action:
              kind: enter
              target: map
          - id: to-dining
            label: 식당차로 간다
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip-half.md
            title: 반쪽 단서 · 은박 한 귀퉁이
            partial: true
            body: 중화이리의 베개 밑에 은박 약판이 있다. 본 것은 한 귀퉁이뿐이라, 적힌 이름도, 몇 정이 비었는지도 모른다. 그는 11시 30분에
              약을 먹고 잤다고 말한다.
        cost:
          clock: -1
      - min: 5
        max: 10
        text: 너무 느렸다. 그가 돌아눕더니 손이 마침 베개 위에 떨어졌고, 한참을 기다린 뒤에야 물러날 수 있었다. 네가 본 것은 베개 밑으로
          삐져나온 은박 약판의 모서리뿐이다.
        options:
          - id: long-way
            label: "돌아가기: 샤청에게 그를 불러내 달라고 하기"
            action:
              kind: read
              paths:
                - world/sleeper/05-long-way.md
          - id: back
            label: 열차로 돌아가기
            action:
              kind: enter
              target: map
          - id: to-dining
            label: 식당차로 간다
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip-half.md
            title: 반쪽 단서 · 은박 한 귀퉁이
            partial: true
            body: 중화이리의 베개 밑에 은박 약판이 있다. 본 것은 한 귀퉁이뿐이라, 적힌 이름도, 몇 정이 비었는지도 모른다. 그는 11시 30분에
              약을 먹고 잤다고 말한다.
      - min: 11
        max: 17
        text: 베개 밑에 수면제 한 판이 눌려 있고, 처방전에는 '중화이리'라고 인쇄되어 있다. 10정들이, 두 정이 없어졌고, 은박은 새로 뜯긴
          것이다.
        options:
          - id: press
            label: 이 약, 두 알이 비어요
            to: zhong-huaili
            say: 선생님 수면제가 두 알 비어 있어요. 두 알을 먹은 사람이 이렇게 얕게 잘 리가 없죠.
            action:
              kind: character
              character: zhong-huaili
          - id: back
            label: 열차로 돌아가기
            action:
              kind: enter
              target: map
          - id: to-dining
            label: 식당차로 간다
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip.md
            image: assets/items/pill-strip.webp
            title: 두 정이 없어진 수면제 판
            body: 중화이리 베개 밑의 수면제 판, 처방전에는 그의 이름이 인쇄되어 있다. 10정들이, 두 정이 없어졌고, 은박은 새로 뜯긴 것이다.
              그는 11시 30분에 약을 먹고 잤다고 했지만—수면제 두 정을 먹은 사람이라면, 이렇게 얕게 잠들어서는 안 된다.
      - min: 18
        max: 20
        text: 베개 밑에 수면제 한 판이 눌려 있고, 처방전에는 '중화이리'라고 인쇄되어 있다. 10정들이, 두 정이 없어졌고, 은박은 새로 뜯긴
          것이다. 그의 손가방은 반쯤 열려 있고, 안에는 단운 터널 사고 12주년 추모식 발언 원고가 있다. 그가 뒤척이기도 전에
          빠져나왔다. 이번 수색은 시간을 쓰지 않는다.
        options:
          - id: press
            label: 이 약, 두 알이 비어요
            to: zhong-huaili
            say: 선생님 수면제가 두 알 비어 있어요. 두 알을 먹은 사람이 이렇게 얕게 잘 리가 없죠.
            action:
              kind: character
              character: zhong-huaili
          - id: back
            label: 열차로 돌아가기
            action:
              kind: enter
              target: map
          - id: to-dining
            label: 식당차로 간다
            action:
              kind: enter
              target: world/dining-car
        rewards:
          - path: world/sleeper/pill-strip.md
            image: assets/items/pill-strip.webp
            title: 두 정이 없어진 수면제 판
            body: 중화이리 베개 밑의 수면제 판, 처방전에는 그의 이름이 인쇄되어 있다. 10정들이, 두 정이 없어졌고, 은박은 새로 뜯긴 것이다.
              그는 11시 30분에 약을 먹고 잤다고 했지만—수면제 두 정을 먹은 사람이라면, 이렇게 얕게 잠들어서는 안 된다.
        bonus:
          clock: 1
    on:
      roll_resolved:
        - run: train-step
        - when: roll.rank <= 2
          run: miss-sleeper
          on_error: continue
map:
  plan:
    picture: assets/maps/sleeper.webp
    pins:
      grey-coat:
        - 0.53
        - 0.28
      pill-strip:
        - 0.64
        - 0.22
      zhong-huaili:
        - 0.58
        - 0.44
      player:
        - 0.5
        - 0.78
view: canvas
passive:
  - id: breath
    skill: listen
    say: "3번 칸의 숨소리가 너무 고르다. 약에 곯아떨어진 사람이 아니라, 문밖 기척에 귀를 기울이는 사람의 숨이다."
    great:
      say: "3번 칸의 숨소리가 너무 고르다. 약에 곯아떨어진 사람이 아니라, 문밖 기척에 귀를 기울이는 사람의 숨이다.머리맡 작은 등의 갓이 아직 따뜻하다. 끈 지 얼마 안 됐다."
---

침대차의 통로는 매우 좁고, 객실 문은 대부분 닫혀 있다. 3번 객실 문만 살짝 열려 있고, 문 앞에 회색 모직 코트가 걸려 있다.

안에 있는 사람은 문을 등지고 누워 있고, 숨소리가 매우 고르다—고른 게 다소 일부러 꾸민 듯하다.
