---
type: gate
name: 2호차 · 경좌차
bg: assets/scenes/seated-car.webp
title: 2호차 · 경좌차
intent: 서장의 유일한 칸. 쑤허의 좌석(17번)과 플레이어의 좌석(18번)이 여기 있다. 첫 턴이 끝나면 엔진이 su-he-notebook.md 파일을 놓는다. 승객에게 묻는 주사위는 search 선언에서 생긴다. 물어본 뒤(또는 여덟 번째 턴), 엔진이 5호차로 통하는 freight-door.md 파일을 놓는다. 서술로 문을 열거나 카드를 놓거나 결말을 선언하지 않는다. 어떤 용의자의 이름도 말하지 않는다.
choice:
  options:
  - id: ask-student
    label: 주사위를 굴려 20번의 깨어 있는 학생에게 묻는다
  allow_free: true
choice_actions:
  ask-student:
    kind: search
    spot: scene
search:
- id: scene
  skill: persuade
  label: 주사위를 굴려 20번의 깨어 있는 학생에게 묻는다
  title: 근처 승객에게 물어본다
  body: |-
    대부분은 잠들어 있다. 깨어 있는 사람은 20번의 학생과, 네가 깨워서 불쾌해하는 몇몇뿐이다.

    1d100(설득 60): 기능 수치 이하면 성공, 낮을수록 좋다.
    96–100(5%): 소란이 너무 커서 사람들을 놀라게 했다. 단서는 반만 얻고, 시간을 두 걸음 더 쓴다.
    61–95(35%): 매끄럽지 않았다. 단서는 반만 얻고, 시간을 한 걸음 더 쓴다.
    13–60(48%): 성공. 단서를 얻고, 시간을 한 걸음만 쓴다.
    1–12(12%): 대성공. 단서를 얻고, 한 가지를 더 보며, 빨라서 시간을 쓰지 않는다.

    같은 카드는 한 번만 굴릴 수 있다. 다시 굴릴 수 없다.
  roll_dice:
    type: 2d10
    desc: 근처 승객에게 물어본다
    expect: '>=11'
  dice_outcomes:
  - min: 2
    max: 4
    text: 사람들을 하나씩 깨우자 객실이 불평으로 가득 찼고, 승무원을 부르라고 소리치는 사람까지 나왔다. 샤청이 모두를 달래고 나니 한참이 지나 있었다. 20번의 학생 저우쯔항은, 0시 50분쯤 누군가 쑤허를 부축해 뒤쪽으로 갔고 그녀의 걸음이 휘청거렸다는 말만 한다. 누구였는지는 "잘 못 봤다"고.
    options:
    - id: talk
      label: 샤청에게 알린다
      say: "절반만 알아냈어요: 누군가 쑤허를 부축해 뒤쪽으로 갔대요. 누군지는 못 봤대요."
      action:
        kind: character
        character: xia-cheng
    rewards:
    - &id001
      path: world/seated-car/witness-half.md
      title: 반쪽 단서 · 누군가 그녀를 뒤쪽으로
      partial: true
      body: '학생 저우쯔항(2호차 20번): 0시 50분쯤 누군가 쑤허를 부축해 열차 뒤쪽으로 갔다. 그녀의 걸음은 휘청거렸다. 누구였는지는 보지 못했다.'
    cost:
      clock: -1
  - min: 5
    max: 10
    text: 몇 사람에게 물어도 다들 자고 있었다고 한다. 겨우 저우쯔항에게 물었지만 낯선 사람을 조금 경계하며, 0시 50분쯤 누군가 쑤허를 부축해 뒤쪽으로 갔고 그녀의 걸음이 휘청거렸다는 말만 했다.
    options:
    - id: talk
      label: 샤청에게 알린다
      say: "절반만 알아냈어요: 누군가 쑤허를 부축해 뒤쪽으로 갔대요. 누군지는 못 봤대요."
      action:
        kind: character
        character: xia-cheng
    rewards:
    - *id001
  - min: 11
    max: 17
    text: 깨어 있는 저우쯔항에게 곧장 간다. 그가 이어폰 한쪽을 뺐다. 열차가 멈추고 얼마 안 돼, 0시 50분쯤, 회색 모직 코트를 입고 머리가 희끗한 노인이 쑤허를 부축해 뒤쪽으로 가면서 "멀미가 나서 뒤에서 바람 좀 쐬게 하려고"라고 했다. 쑤허는 잠이 덜 깬 것처럼 휘청거렸다.
    options:
    - id: talk
      label: 샤청에게 알린다
      say: "알아냈어요: 회색 모직 코트를 입은 머리 희끗한 노인이 그녀를 부축해 뒤쪽으로 갔대요."
      action:
        kind: character
        character: xia-cheng
    rewards:
    - &id002
      path: world/seated-car/witness-account.md
      title: 저우쯔항의 증언
      body: '학생 저우쯔항(2호차 20번): 0시 50분쯤, 회색 모직 코트를 입고 머리가 희끗희끗한 노인이 쑤허를 부축해 열차 뒤쪽으로 걸어가면서 ''멀미가 나서 뒤에서 바람 좀 쐬게 하려고''라고 했다. 쑤허는 걸음이 휘청거렸고, 마치 잠이 덜 깬 것 같았다. 노인의 얼굴은 보지 못했다.'
  - min: 18
    max: 20
    text: '깨어 있는 저우쯔항에게 곧장 간다. 그가 이어폰 한쪽을 뺐다. 열차가 멈추고 얼마 안 돼, 0시 50분쯤, 회색 모직 코트를 입고 머리가 희끗한 노인이 쑤허를 부축해 뒤쪽으로 가면서 "멀미가 나서 뒤에서 바람 좀 쐬게 하려고"라고 했다. 쑤허는 잠이 덜 깬 것처럼 휘청거렸다. 노인에게서 장뇌 냄새가 났다고도 한다. 상자 바닥에 넣어 둔 옛날 옷 같은. 단번에 맞는 사람에게 물었다: 이번 판정은 시간을 쓰지 않는다.'
    options:
    - id: talk
      label: 샤청에게 알린다
      say: "알아냈어요: 회색 모직 코트를 입은 머리 희끗한 노인이 그녀를 부축해 뒤쪽으로 갔대요."
      action:
        kind: character
        character: xia-cheng
    rewards:
    - *id002
    bonus:
      clock: 1
  'on':
    roll_resolved:
    - run: train-step
map:
  plan:
    picture: assets/maps/seated-car.webp
    pins:
      su-he-notebook:
      - 0.41
      - 0.41
      witness-account:
      - 0.67
      - 0.43
      witness-half:
      - 0.67
      - 0.43
      freight-car:
      - 0.93
      - 0.45
      xia-cheng:
      - 0.3
      - 0.6
      player:
      - 0.5
      - 0.74
---

새벽 1시 10분. 링커우행 K7 막차가 단운 터널 한가운데 멈췄고, 객실에는 비상등만 켜져 있다.

옆자리 17번은 비어 있고, 캔버스 가방과 보온병만 남아 있다. 승무원 샤청이 통로에 서서 손전등으로 빈자리를 비추고 있다.
