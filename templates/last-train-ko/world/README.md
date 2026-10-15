---
type: readme
name: 단운 터널 · 멈춘 막차
bg: assets/scenes/tunnel-train.webp
title: 단운 터널 · 멈춘 막차
intent: "열차 전체의 개요. 제2막은 여기서 시작한다. 3막 구성: 제1막은 2호차 경좌차(시작 지점); 제2막은 이 지도에서 3호차
  침대차, 4호차 식당차, 1호차 운전실로 간다. 세 갈래는 순서가 자유롭고 각각 수수께끼가 하나씩 있다; 제3막은 5호차 화물차로, 잠겨
  있어 player/freight-key.md 파일이 가방에 있을 때만 들어갈 수 있다. 제한 시간은 world/departure-clock.md의
  status.data.left이며 엔진의 tick만 바꿀 수 있다. 작가는 손으로 바꾸지 말 것. 서술로 잠긴 문을 열지 말고, 서술로
  결말을 선언하지 말 것."
states:
- id: turns
  label: "턴"
  type: number
  initial: 0
  range:
  - 0
  - 999
  hidden: true
choice:
  options:
    - id: go-sleeper
      label: 3호차 침대차로 간다
    - id: go-dining
      label: 4호차 식당차로 간다
    - id: go-cab
      label: 1호차 운전실로 간다
    - id: read-list
      label: 샤청의 승객 명단 보기
      once: true
    - id: ask-awake
      label: 이 시간에 누가 아직 깨어 있죠?
      to: companion
      say: 이 시간에, 열차에서 또 누가 깨어 있죠?
  allow_free: true
choice_actions:
  go-sleeper:
    kind: enter
    target: world/sleeper
  go-dining:
    kind: enter
    target: world/dining-car
  go-cab:
    kind: enter
    target: world/cab
  read-list:
    kind: read
    paths:
      - world/passenger-list.md
map:
  plan:
    picture: assets/maps/tunnel-train.webp
    pins:
      cab:
        - 0.19
        - 0.39
      seated-car:
        - 0.34
        - 0.39
      sleeper:
        - 0.52
        - 0.39
      dining-car:
        - 0.7
        - 0.39
      freight-car:
        - 0.89
        - 0.39
      departure-clock:
        - 0.12
        - 0.2
      passenger-list:
        - 0.34
        - 0.61
      xia-cheng:
        - 0.44
        - 0.6
      player:
        - 0.55
        - 0.6
view: map
---
새벽 1시가 조금 넘었다. 링커우행 K7 막차는 돤윈 터널 한가운데에 멈춰 서 있다. 앞쪽에 산사태가 났고, 객차에는 비상등만 켜져 있다.

2호차 17번의 쑤허가 사라졌다. 캔버스 가방과 보온병은 아직 자리에 그대로 있다.

복구반은 다섯 시 정각에 개통된다고 한다. 침대차, 식당차, 운전실 — 어디부터 갈지는 자유다. 맨 끝의 화물차는 잠겨 있다.
