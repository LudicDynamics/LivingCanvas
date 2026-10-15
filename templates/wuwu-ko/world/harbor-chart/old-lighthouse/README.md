---
type: gate
name: 옛 등대 · 꺼진 불빛
title: 옛 등대 · 꺼진 불빛
bg: assets/scenes/old-lighthouse.webp
intent: 등유 빌리기는 '등유 한 몫 빌리기' 버튼으로 world/harbor-chart/old-lighthouse/lamp-oil.md 파일을 player/lamp-oil.md 파일로 확정적으로 옮긴다. 작가는 등유를 따로 만들지 않고 두 번째 몫을 지급하지도 않는다. 일지는 불이 꺼진 시각만 증명한다. 모 영감이 모르는 두 번째 배를 그의 기억으로 조작하지 마라.
choice:
  options:
    - id: search
      label: 망원경으로 옛 터널 입구 보기 (주사위)
    - id: action-1
      label: 등대 일지 읽기
    - id: action-2
      label: 등유 한 몫 빌리기
    - id: action-3
      label: 모 영감에게 그 십이 분에 대해 묻기
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/lighthouse.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/harbor-chart/old-lighthouse/lighthouse-logbook.md
  action-2:
    kind: take
    paths:
      - world/harbor-chart/old-lighthouse/lamp-oil.md
  action-3:
    kind: character
    character: old-mo
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: spot_hidden
    label: 망원경으로 옛 터널 입구 보기 (주사위)
    title: 모 영감의 망원경으로 옛 터널 입구 보기
    body: |-
      등갑에 서면, 모 영감의 놋쇠 망원경으로 항구 건너편 옛 세관 터널 입구까지 볼 수 있다—안개가 비켜 주고, 젖은 난간 위에서 네 손이 버텨 준다면.

      이 주사위가 결정하는 것은: 옛 등대 실마리를 그 자리에서 못 박을 수 있는지, 그리고 모 영감의 망원경이 어떻게 되는지다. 눈금이 좋으면 증거가 바로 가방에 들어간다; 눈금이 나쁘면 반쪽 실마리만 얻는다; 눈금이 아주 나쁘면 망원경이 깨진다. 못 박지 못한 실마리는 사라지지 않는다: 카드에 '돌아가기'가 열려, 모 영감에게 일지를 일 분씩 대조해 달라 청할 수 있다, 다만 조수 한 구간을 더 쓴다.

      주사위가 필요 없고 언제든 할 수 있는 일: 등대 일지 읽기, 모 영감에게 그 십이 분에 대해 묻기, 등유 한 몫 빌리기. 이것들은 조수를 쓰지 않지만, 대신 실마리를 못 박아 주지도 않는다.

      1d100(관찰력 60): 기능 수치 이하면 성공, 낮을수록 좋다.
      96–100 (5%): 젖어 미끄러운 등갑 계단에서 넘어져 망원경도 깨졌고, 모 영감이 그것을 보았다. 그는 이 일을 기억할 것이다; 조수가 한 걸음 더 밀려온다; 등유를 챙겼다면 당황한 와중에 태워 버린다. 돌아가기밖에 없다.
      61–95 (35%): 안개가 터널 입구를 덮어 반쪽 실마리(오늘 밤 조석표)만 얻는다. 돌아가기밖에 없다.
      13–60 (48%): 터널 입구를 제대로 보고, 증거 '옛 세관 터널과 꺼진 십이 분'이 가방에 들어가며, 지목 카드에 ✓가 찍힌다.
      1–12 (12%): 위와 같고, 게다가 빨리 살폈다: 이 주사위는 조수를 쓰지 않는다.

      조수: 주사위를 굴릴 때마다 한 걸음 줄어든다(대성공 제외); 96–100에 떨어지면 한 걸음 더 줄어든다; 돌아가기를 하면 한 걸음 더 줄어든다. 이 카드는 한 번만 굴릴 수 있다.
    roll_dice:
      type: 2d10
      desc: 모 영감의 망원경으로 옛 터널 입구 보기
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
        harm: serious
        text: 등갑의 젖은 계단에서 발이 헛디뎌, 망원경이 미끄러져 돌에 부딪혀 깨졌고, 너도 바로 누운 채 몇 계단을 굴렀다. 모 영감이 보았다. 이 실마리는 못 박지 못했다; 그날 밤 일을 다시 묻기 전에 먼저 사과하고, 돌아가기를 거쳐 그와 함께 일지를 대조해야 한다.
        options:
          - id: long-way
            label: "돌아가기: 모 영감에게 일지를 일 분씩 대조해 달라 청하기"
            action:
              kind: read
              paths:
                - world/harbor-chart/old-lighthouse/05-long-way.md
          - id: back
            label: 지도로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: 안개가 터널 입구를 덮었다. 너는 모 영감 책상 위 오늘 밤 조석표만 얻었다—터널을 언제 쓸 수 있는지는 알려 주지만, 꺼진 십이 분이 바로 그때를 향한다는 것은 알려 주지 않는다. 네가 얻은 것은 반쪽 실마리이고, 못 박으려면 돌아가기를 해야 한다.
        options:
          - id: long-way
            label: "돌아가기: 모 영감에게 일지를 일 분씩 대조해 달라 청하기"
            action:
              kind: read
              paths:
                - world/harbor-chart/old-lighthouse/05-long-way.md
          - id: back
            label: 지도로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: 안개가 얇아졌다. 저조 때 터널 입구가 수면 위로 드러나고, 일지에 적힌 꺼진 십이 분이 바로 그 구간이다. 옛 등대의 실마리가 못 박혔다.
        options:
          - id: read-evidence
            label: 이 증거 보기
            action:
              kind: read
              paths:
                - player/customs-tunnel.md
          - id: back
            label: 지도로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: "안개가 비켜서자 터널 입구가 또렷하다: 수면 위로 드러나는 시각과 꺼진 십이 분이 빈틈없이 맞물린다. 옛 등대의 실마리가 못 박혔고, 게다가 빨리 살펴 조수가 거의 움직이지 않았다."
        options:
          - id: read-evidence
            label: 이 증거 보기
            action:
              kind: read
              paths:
                - player/customs-tunnel.md
          - id: back
            label: 지도로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank >= 3
          run: evidence-tunnel
          on_error: continue
        - when: roll.rank <= 2
          run: miss-lighthouse
          on_error: continue
        - when: roll.rank == 1 && has("player/lamp-oil.md")
          run: burn-lamp-oil
          on_error: continue
        - when: roll.rank <= 3
          run: tide-step
          on_error: continue
        - when: roll.rank == 1
          run: tide-surge
          on_error: continue
  - id: peek-logbook
    skill: stealth
    label: 모 영감이 눈치채기 전에 일지를 넘겨 보기
    title: 모 영감이 눈치채기 전에 일지를 넘겨 보기
    body: |-
      모 영감의 일지가 책상 위에 펼쳐져 있고, 그는 등을 등지고 기름을 붓고 있다.

      지금 넘겨 봐도 된다—넘기지 않고 바로 물어도 된다. 넘기든 말든 조수는 들지 않는다; 다만 그가 보면, 그 뒤의 이야기는 쉽지 않을 것이다. 대성공(1–12)이면 그는 한 번도 돌아보지 않고, 너는 그 한 줄을 종잇조각에 베껴 가져갈 수 있다.
    roll_dice:
      type: 2d10
      desc: 모 영감이 돌아서서 기름을 붓는 사이, 책상 위 일지를 펼쳐 보기
      expect: ">=11"
    on:
      roll_resolved:
        - run: peek-logbook
map:
  pins:
    lighthouse-logbook:
      - 0.25
      - 0.74
    lamp-oil:
      - 0.16
      - 0.66
    old-mo:
      - 0.62
      - 0.62
    player:
      - 0.45
      - 0.9
  plan:
    picture: assets/maps/old-lighthouse.webp
    pins:
      lighthouse-logbook:
        - 0.35
        - 0.48
      lamp-oil:
        - 0.3
        - 0.36
      old-mo:
        - 0.56
        - 0.53
      player:
        - 0.49
        - 0.75
---

등대지기 모 영감은 그날 밤 자기가 불을 십이 분 동안 껐다고 말한다. 왜 하필 그 시간이었을까?

일지를 읽고 모 영감에게 묻는 데는 주사위가 필요 없다. 여기 실마리를 못 박으려면 모 영감의 망원경으로 옛 터널 입구를 봐야 한다—눈금에 따라 터널 입구를 제대로 보는지, 조석표만 얻는지, 망원경을 떨어뜨리는지가 결정된다. 모 영감에게는 빌려줄 등유가 한 몫뿐이다: 해도 위의 결정적 판정은 안개 속 가장 미끄러운 디딤돌에 서야 하니, 그것을 챙기면 훨씬 안정적이다.
