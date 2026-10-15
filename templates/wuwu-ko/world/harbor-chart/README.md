---
type: gate
name: 항구 해도 · 그 배를 조사하기
title: 항구 해도 · 그 배를 조사하기
bg: assets/scenes/harbor-chart.webp
requires:
  items:
    - player/commission-letter.md
    - player/investigator-badge.md
blocked: 위임장과 조사원 휘장을 모두 가방에 넣어라.
intent: "여기는 장소 일람이다. 증거 수집 순서는 자유다. 귀환 지점은 항무소다. 보유하지 않은 물품을 서술만으로 넘어가는 것은 허용되지 않는다. 이것은 닫힌 한 판이다: 결말은 세 가지(폭로, 놓침, 안개에 삼켜짐)뿐이며, 결말은 엔진의 end로만 발동한다. 작가는 결말을 선언하지 않고, beyond-the-fog 등에서 새 장소를 생성하지도 않는다."
bgVideo: assets/motion/seedance/backgrounds/map.webm
choice:
  options:
    - id: search
      label: "결정적 판정: 안개 속에서 두 번째 항적 찾기 (주사위)"
    - id: go-accuse
      label: "지목 카드 보기: 어떤 실마리가 못 박혔는지"
  allow_free: true
choice_actions:
  search:
    kind: search
    spot: fog
  go-accuse:
    kind: read
    paths:
      - world/harbor-chart/05-accuse.md
search:
  - id: fog
    skill: navigate
    label: "결정적 판정: 안개 속에서 두 번째 항적 찾기 (주사위)"
    title: 결정적 판정 · 안개 속에서 두 번째 항적 찾기
    body: |-
      이것은 한 판 전체에서 가장 위험한 판정이다: 조수가 다시 밀려오기 전에, 항구 가장 바깥쪽 디딤돌에 서서 안개 속에서 두 번째 항적을 찾아라. 이 카드는 한 번만 굴릴 수 있다.

      이 주사위가 결정하는 것은: 해도 위의 실마리를 그 자리에서 못 박을 수 있는지, 그리고 네가 안개에 삼켜질지다. 눈금이 좋으면 항적을 보고 증거가 바로 가방에 들어간다; 눈금이 나쁘면 반쪽 실마리(물자국 하나)만 보고, 돌아가기를 거쳐 물가를 따라 쫓아야 한다; 눈금이 아주 나쁘면, 손에 등유가 있으면 그것을 태워 버티고, 등유가 없으면 이 판은 여기서 끝난다.

      주사위를 굴릴 필요 없이 언제든 할 수 있는 일: "또 다른 배를 찾기"에서 자료를 늘어놓고 상의하기, 단서 다시 읽기, 사람에게 묻기. 이것들은 조수를 소모하지 않지만, 대신 실마리를 못 박아 주지도 않는다.

      1d100(항법 60): 기능 수치 이하면 성공, 낮을수록 좋다.
      96–100(5%): 발이 미끄러져 암초에 크게 넘어져 크게 다치고, 안개가 닫혀 온다. **손에 등유가 있으면 불을 켜 버티지만, 그 한 몫의 기름은 다 타 버리고 아무것도 못 본 채 돌아가기밖에 없다; 불을 켤 기름이 없으면(빌린 적이 없거나 이미 다 타 버렸으면) 안개에 삼켜져 이번 판은 거기서 끝난다.** 조수가 한 걸음 더 소모된다.
      61–95(35%): 배는 못 보고 반쪽 실마리(물자국 하나)만 얻는다. 돌아가기밖에 없다.
      13–60(48%): 두 번째 항적을 또렷이 보고, 증거가 가방에 들어오며, 지목 카드에 ✓가 찍힌다.
      1–12(12%): 위와 같으며, 그것이 얼마나 깊이 잠겼는지까지 보이고, 이번 굴림은 조수를 소모하지 않는다.

      조수: 굴릴 때마다 한 걸음 줄어든다(대성공 제외); 96–100에 떨어지면 한 걸음 더 줄어든다; 돌아가기도 한 걸음 더 줄어든다. 옛 등대로 가서 등유 한 몫을 빌려 다시 오면 훨씬 안정적이다.
    roll_dice:
      type: 2d10
      desc: 안개 속에서 두 번째 항적 찾기
      expect: ">=11"
    choice:
      options:
        - id: back
          label: 일단 주사위를 굴리지 않고 지도로 돌아가기
    choice_actions:
      back:
        kind: enter
        target: world/harbor-chart
    dice_outcomes:
      - min: 2
        max: 4
        harm: grave
        text: 발밑의 젖은 돌이 미끄러져 몸 전체가 암초 아래로 떨어지고, 반쪽 몸이 다시 밀려오는 조수에 잠기며 안개가 단번에 닫혀 온다. 손에 등유가 있으면 불을 켜 버티지만, 그 한 몫의 기름도 다 타 버린다—아무것도 못 봤고 이 실마리는 못 박지 못한 채 돌아가기밖에 없다. 불을 켤 기름이 없으면 안개가 너를 삼킨다.
        options:
          - id: long-way
            label: "돌아가기: 물자국을 따라 물가를 걷기"
            action:
              kind: read
              paths:
                - world/harbor-chart/06-long-way.md
          - id: back
            label: 조사로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: 배는 보지 못하고 안개 속에 일렁이는 물자국 하나만 보았다. 옛 세관 터널 입구 쪽에서 꺾여 나와 다시 안개 속으로 사라진다. 네가 얻은 것은 반쪽 실마리이고, 그것을 못 박으려면 돌아가야 한다.
        options:
          - id: long-way
            label: "돌아가기: 물자국을 따라 물가를 걷기"
            action:
              kind: read
              paths:
                - world/harbor-chart/06-long-way.md
          - id: back
            label: 조사로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: "안개가 한순간 옅어진다: 두 번째 항적이 옛 세관 터널 입구에서 나와 무인선을 스치듯 지나 다시 안개 속으로 꺾여 들어간다. 해도 위에 실마리가 못 박혔다."
        options:
          - id: read-wake
            label: 두 번째 항적 보기
            action:
              kind: read
              paths:
                - player/second-wake.md
          - id: back
            label: 조사로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: "안개가 비키자 두 번째 항적이 또렷이 보인다: 옛 세관 터널 입구에서 나와 무인선을 스치듯 지나가고, 흘수가 깊어 만재한 배 같다. 해도 위에 실마리가 못 박혔고, 게다가 빨리 살폈으므로 조수는 거의 움직이지 않았다."
        options:
          - id: read-wake
            label: 두 번째 항적 보기
            action:
              kind: read
              paths:
                - player/second-wake.md
          - id: back
            label: 조사로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank == 1 && has("player/empty-oil-flask.md") || roll.rank == 1 && has("world/harbor-chart/old-lighthouse/lamp-oil.md")
          run: fog-swallows
          on_error: continue
        - when: roll.rank == 1 && has("player/lamp-oil.md")
          run: burn-lamp-oil
          on_error: continue
        - when: roll.rank >= 3
          run: evidence-wake
          on_error: continue
        - when: roll.rank <= 2
          run: miss-chart
          on_error: continue
        - when: roll.rank <= 3
          run: tide-step
          on_error: continue
        - when: roll.rank == 1
          run: tide-surge
          on_error: continue
map:
  pins:
    old-lighthouse:
      - 0.22
      - 0.24
    seventh-berth:
      - 0.42
      - 0.52
    workshop:
      - 0.64
      - 0.62
    player:
      - 0.17
      - 0.87
  plan:
    picture: assets/maps/harbor-chart.webp
    pins:
      old-lighthouse:
        - 0.19
        - 0.12
      seventh-berth:
        - 0.47
        - 0.5
      workshop:
        - 0.85
        - 0.48
      player:
        - 0.16
        - 0.73
---

먼저 7번 부두로 가서 배에 남은 흔적을 보라. 공방에서는 배 부품을 조사할 수 있고, 등대에서는 불이 꺼진 시간을 조사할 수 있다. 순서는 네 마음대로다.

단서를 읽고, 사람에게 묻고, 자료를 늘어놓는 데는 조수가 들지 않고 주사위도 굴리지 않는다. 각 장소에는 한 번만 굴릴 수 있는 조사 주사위 카드가 따로 있다. 눈금에 따라 그 실마리를 그 자리에서 못 박을 수 있는지가 결정된다. 성공하면 증거를 가방에 넣는다. 실패하면 반쪽 실마리만 얻거나 인기척에 사람이 놀라서, 돌아가기를 거쳐 다시 못 박아야 하고 조수가 더 든다. 해도 위에는 가장 위험한 결정적 판정이 하나 더 있다. 안개 속에서 두 번째 항적을 찾는 일이다. 되도록 옛 등대에 먼저 가서 등유 한 몫을 빌리는 게 좋다. 잘못 굴리면 다치기도 한다. 미끄러운 암초, 현문 사다리, 등대의 계단, 다시 밀려오는 조수. 너무 크게 다치면 지목 단계까지 가지 못한다.

네 실마리를 모두 못 박은 뒤, 지목 카드에서 지목하라. 조수가 다시 밀려오기 전에 지목하지 않으면, 두 번째 배는 안개 속으로 사라진다.
