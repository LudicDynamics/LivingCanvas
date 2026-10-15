---
type: gate
name: 2호차 · 경좌차
bg: assets/scenes/seated-car.webp
title: 2호차 · 경좌차
intent: '제1막(시작 지점). 쑤허의 좌석(17번)과 플레이어의 좌석(18번)이 모두 여기 있다. 흐름: 샤청이 먼저 말을 건다 →
  플레이어가 수첩을 집어 든다 → 주사위로 20번 학생에게 묻는다(증언은 이 한 번의 굴림으로 얻는다. "그와 이야기하러 간다"는 더 이상 기본 선택지가 아니다) → 증언을 얻는다 → 3호차 침대차로, 또는 열차
  지도로 돌아간다(증언을 얻거나 이 칸에서 네 박자를 보내면 선택지 맨 앞에 이 두 출구가 나온다). 학생 저우쯔항(20번)은 NPC 카드 zhou-zihang.md(그를 클릭해 "대화")이며,
  witness-account.md에 적힌 것만 말할 수 있다: 노인의 얼굴은 제대로 보지 못했고, 회색 모직 코트와 희끗한 머리만
  기억한다.'
status:
  data:
    exits: "no"
choice:
  options:
    - id: go-sleeper
      label: 뒤쪽 침대차(3호차)로 가기
      when: exits == "open"
    - id: go-train
      label: 열차 전체로 돌아가 보기
      when: exits == "open"
    - id: take-notebook
      label: 쑤허가 남긴 수첩을 집어 든다
    - id: search
      label: 주사위를 굴려 아직 깨어 있는 20번 학생에게 물어본다
    - id: ask-who
      label: 쑤허가 누구예요?
      to: xia-cheng
      say: 쑤허가 누구예요? 아는 사람이에요?
  allow_free: true
choice_actions:
  go-sleeper:
    kind: enter
    target: world/sleeper
  go-train:
    kind: enter
    target: map
  take-notebook:
    kind: take
    paths:
      - world/seated-car/su-he-notebook.md
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: persuade
    label: 주사위를 굴려 아직 깨어 있는 20번 학생에게 물어본다
    title: 근처 승객에게 물어본다
    body: >-
      대부분은 잠들어 있다. 깨어 있는 사람은 20번의 학생과, 네가 깨워서 불쾌해하는 몇몇뿐이다.


      1d100(설득 60): 기능 수치 이하면 성공, 낮을수록 좋다.

      96–100(5%): 소란이 너무 커서 사람들을 놀라게 했다. 단서는 반만 얻고, 시간을 두 걸음 더 쓴다.

      61–95(35%): 매끄럽지 않았다. 단서는 반만 얻고, 시간을 한 걸음 더 쓴다.

      13–60(48%): 성공. 단서를 얻고, 시간을 한 걸음만 쓴다.

      1–12(12%): 대성공. 단서를 얻고, 한 가지를 더 보며, 빨라서 시간을 쓰지 않는다.


      굴릴 때마다 출발에 한 걸음 가까워진다(실패하면 한 걸음 더, 대성공이면 한 걸음 되찾는다). 같은 카드는 한 번만 굴릴 수 있고,
      다시 굴릴 수 없다. 아직 물어볼 생각이 없으면, 굴리지 말고 이 칸에 그대로 있는다.
    roll_dice:
      type: 2d10
      desc: 근처 승객에게 물어본다
      expect: ">=11"
    choice:
      options:
        - id: back
          label: 아직 굴리지 않는다
    choice_actions:
      back:
        kind: enter
        target: world/seated-car
    dice_outcomes:
      - min: 2
        max: 4
        text: 한 사람씩 깨우는 사이 객차 안은 불평으로 가득 찼고, 누군가는 승무원을 찾아가 너를 고자질했다. 샤청이 모두를 달래 놓았을 때는
          이미 한참이 지났고, 저우쯔항은 다시 이어폰을 꽂았다. 그가 말해 주는 것은 0시 50분쯤 누군가 쑤허를 부축해 열차
          뒤쪽으로 갔다는 것뿐이다. 누구였는지는 "못 봤다"고 한다.
        options:
          - id: tell
            label: 샤청에게 알린다
            to: xia-cheng
            say: "절반만 알아냈어요: 누군가 쑤허를 부축해 뒤쪽으로 갔대요. 누군지는 말을 안 해요."
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: 열차로 돌아가기
            action:
              kind: enter
              target: map
          - id: to-rear
            label: 차 뒤쪽으로 간다(3호차 침대차)
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-half.md
            title: 반쪽 단서 · 누군가 그녀를 뒤쪽으로
            partial: true
            body: "학생 저우쯔항(2호차 20번): 0시 50분쯤 누군가 쑤허를 부축해 열차 뒤쪽으로 갔다. 그녀의 걸음은 휘청거렸다. 누구였는지는
              말하려 하지 않았다."
        cost:
          clock: -1
      - min: 5
        max: 10
        text: 물어본 사람들은 다들 자고 있었다고 한다. 겨우 저우쯔항에게 닿았지만 낯선 사람을 경계해서, 0시 50분쯤 누군가 쑤허를 부축해
          열차 뒤쪽으로 갔고 그녀의 걸음이 휘청거렸다는 것만 말한다.
        options:
          - id: tell
            label: 샤청에게 알린다
            to: xia-cheng
            say: "절반만 알아냈어요: 누군가 쑤허를 부축해 뒤쪽으로 갔대요. 누군지는 말을 안 해요."
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: 열차로 돌아가기
            action:
              kind: enter
              target: map
          - id: to-rear
            label: 차 뒤쪽으로 간다(3호차 침대차)
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-half.md
            title: 반쪽 단서 · 누군가 그녀를 뒤쪽으로
            partial: true
            body: "학생 저우쯔항(2호차 20번): 0시 50분쯤 누군가 쑤허를 부축해 열차 뒤쪽으로 갔다. 그녀의 걸음은 휘청거렸다. 누구였는지는
              말하려 하지 않았다."
      - min: 11
        max: 17
        text: "너는 곧장 깨어 있는 저우쯔항에게 다가갔다. 저우쯔항이 말한다: 정차한 지 얼마 안 된 0시 50분쯤, 회색 모직 코트를 입고
          머리가 희끗희끗한 노인이 쑤허를 부축해 차 뒤쪽으로 걸어갔고, 그녀가 '멀미가 나서 뒤에서 바람을 쐬게 해주려 한다'고 했다.
          쑤허는 걸음이 휘청거렸고, 마치 잠이 덜 깬 것 같았다."
        options:
          - id: tell
            label: 샤청에게 알린다
            to: xia-cheng
            say: "알아냈어요: 회색 모직 코트를 입은 머리 희끗한 노인이 그녀를 부축해 뒤쪽으로 갔대요."
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: 열차로 돌아가기
            action:
              kind: enter
              target: map
          - id: to-rear
            label: 차 뒤쪽으로 간다(3호차 침대차)
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-account.md
            title: 저우쯔항의 증언
            body: "학생 저우쯔항(2호차 20번): 0시 50분쯤, 회색 모직 코트를 입고 머리가 희끗희끗한 노인이 쑤허를 부축해 차 뒤쪽으로
              걸어갔고, 그녀가 '멀미가 나서 뒤에서 바람을 쐬게 해주려 한다'고 했다. 쑤허는 걸음이 휘청거렸고, 마치 잠이 덜 깬
              것 같았다. 노인의 얼굴은 보지 못했다."
      - min: 18
        max: 20
        text: "너는 곧장 깨어 있는 저우쯔항에게 다가갔다. 저우쯔항이 말한다: 정차한 지 얼마 안 된 0시 50분쯤, 회색 모직 코트를 입고
          머리가 희끗희끗한 노인이 쑤허를 부축해 차 뒤쪽으로 걸어갔고, 그녀가 '멀미가 나서 뒤에서 바람을 쐬게 해주려 한다'고 했다.
          쑤허는 걸음이 휘청거렸고, 마치 잠이 덜 깬 것 같았다. 그는 노인에게서 장뇌 냄새도 맡았는데, 마치 상자 밑에 넣어둔 옷
          같은 냄새였다. 곧장 맞는 사람에게 갔다. 이번 판정은 시간을 쓰지 않는다."
        options:
          - id: tell
            label: 샤청에게 알린다
            to: xia-cheng
            say: "알아냈어요: 회색 모직 코트를 입은 머리 희끗한 노인이 그녀를 부축해 뒤쪽으로 갔대요."
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: 열차로 돌아가기
            action:
              kind: enter
              target: map
          - id: to-rear
            label: 차 뒤쪽으로 간다(3호차 침대차)
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-account.md
            title: 저우쯔항의 증언
            body: "학생 저우쯔항(2호차 20번): 0시 50분쯤, 회색 모직 코트를 입고 머리가 희끗희끗한 노인이 쑤허를 부축해 차 뒤쪽으로
              걸어갔고, 그녀가 '멀미가 나서 뒤에서 바람을 쐬게 해주려 한다'고 했다. 쑤허는 걸음이 휘청거렸고, 마치 잠이 덜 깬
              것 같았다. 노인의 얼굴은 보지 못했다."
        bonus:
          clock: 1
    on:
      roll_resolved:
        - run: train-step
map:
  plan:
    picture: assets/maps/seated-car.webp
    pins:
      zhou-zihang:
        - 0.78
        - 0.5
      su-he-notebook:
        - 0.41
        - 0.41
      witness-account:
        - 0.67
        - 0.43
      player:
        - 0.5
        - 0.74
view: canvas
passive:
  - id: drag-marks
    skill: spot_hidden
    say: "17번 좌석 밑 바닥에 뒤꿈치를 끈 자국이 희미하게 두 줄, 열차 뒤쪽으로 나 있다."
---

경좌차 안의 대부분은 잠들어 있고, 누군가는 외투를 둘러싸고 코를 골고 있다. 17번 좌석 위에는 캔버스 가방 하나, 보온병 하나, 그리고 펼쳐진 수첩 한 권이 놓여 있다.

두 좌석 건너의 학생 저우쯔항은 이어폰을 끼고 있고, 내내 자지 않은 듯하다.
