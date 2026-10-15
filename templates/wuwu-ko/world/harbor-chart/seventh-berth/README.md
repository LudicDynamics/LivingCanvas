---
type: gate
name: 7번 부두 · 배에 남은 흔적
title: 7번 부두 · 배에 남은 흔적
bg: assets/scenes/seventh-berth.webp
intent: 수위 흔적을 조사한 뒤, 상대에게 실제 기록을 읽게 한다. 은솔개는 빈 상자를 내보여도 그 정체불명의 배의 전모를 단정하지는 않는다.
choice:
  options:
    - id: search
      label: 교대를 틈타 배에 올라 화물칸을 뒤진다 (주사위)
    - id: action-1
      label: 배에 남은 흔적의 설명을 읽는다
    - id: action-2
      label: 은솔개에게 상자에 대해 묻는다
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/dock.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/harbor-chart/seventh-berth/waterline-trace.md
  action-2:
    kind: character
    character: silver-kite
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: stealth
    label: 교대를 틈타 배에 올라 화물칸을 뒤진다 (주사위)
    title: 교대를 틈타 무인선에 올라 빈 화물칸을 연다
    body: |-
      은솔개가 교대 중이라 현문 사다리를 지키는 사람이 1분간 없다. 그 무인선에 올라 화물칸을 열기에는 충분하다.

      이 주사위가 결정하는 것은 7번 부두의 실마리를 그 자리에서 못 박을 수 있는지다. 눈금이 좋으면 증거가 바로 가방에 들어온다. 나쁘면 반쪽 실마리만 얻는다. 아주 나쁘면 은솔개에게 그 자리에서 붙잡힌다. 못 박지 못한 실마리는 사라지지 않는다. 카드에 '돌아가기'가 열려 은솔개에게 직접 화물칸을 열어 달라 청할 수 있다. 다만 조수가 한 구간 더 든다.

      주사위가 필요 없고 언제든 할 수 있는 일: 긁힌 자국 기록을 읽고, 은솔개에게 상자에 대해 묻는다. 조수는 들지 않지만 실마리를 대신 못 박아 주지는 않는다.

      1d100(은밀행동 60): 기능 수치 이하면 성공, 낮을수록 좋다.
      96–100(5%): 은솔개에게 들켜 현문 사다리에서 부딪혀 다쳤다. 아무것도 얻지 못했고, 그는 이 일을 기억할 것이다. 조수가 한 걸음 더 소모된다. 등유를 가지고 있었다면 당황한 나머지 다 태워 버린다. 돌아가는 길밖에 없다.
      61–95(35%): 화물칸을 열 시간이 없어 반쪽 실마리(다른 배의 페인트 조각)만 얻는다. 돌아가는 길밖에 없다.
      13–60(48%): 화물칸을 열어 증거 "그 배는 미끼다"가 소지품에 들어오고, 지목 카드에 ✓를 찍는다.
      1–12(12%): 위와 같으며, 게다가 빨리 살폈다: 이번 판정은 조수를 소모하지 않는다.

      조수: 주사위를 굴릴 때마다 한 걸음 줄어든다(대성공 제외); 96–100에 떨어지면 한 걸음 더 줄어든다; 돌아가기를 하면 한 걸음 더 줄어든다. 이 카드는 한 번만 굴릴 수 있다.
    roll_dice:
      type: 2d10
      desc: 교대를 틈타 무인선에 올라 빈 화물칸을 연다
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
        harm: light
        text: 현문 사다리 꼭대기에 오르자마자 은솔개의 손이 옷깃을 움켜쥐고 끌어내렸고, 갈비뼈가 난간을 따라 내리찍혔다. 화물칸에 대해서는 한마디도 하지 않았다—그저 사다리를 닫아 버렸다. 이 실마리는 못 박지 못했다. 화물칸에 무엇이 있는지 알려면 돌아가서 그를 직접 만나야 한다.
        options:
          - id: long-way
            label: "돌아가기: 은솔개에게 직접 화물칸을 열어 달라 청하기"
            action:
              kind: read
              paths:
                - world/harbor-chart/seventh-berth/05-long-way.md
          - id: back
            label: 지도로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: 화물칸을 열 시간이 없었다. 만조선보다 높은 긁힌 자국에서 다른 배의 검은 페인트만 긁어냈다—두 번째 배가 있다는 건 증명해도, 이 배가 미끼라는 건 증명하지 못한다. 얻은 것은 반쪽 실마리이고, 못 박으려면 돌아가야 한다.
        options:
          - id: long-way
            label: "돌아가기: 은솔개에게 직접 화물칸을 열어 달라 청하기"
            action:
              kind: read
              paths:
                - world/harbor-chart/seventh-berth/05-long-way.md
          - id: back
            label: 지도로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: 화물칸 뚜껑이 열렸다. 안에는 밸러스트와 못 박힌 빈 상자뿐. 이 배는 일부러 비워 내보낸 것이다—7번 부두의 실마리를 못 박았다.
        options:
          - id: read-evidence
            label: 이 증거 보기
            action:
              kind: read
              paths:
                - player/decoy-ship.md
          - id: back
            label: 지도로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: "뚜껑이 한 번에 열렸고, 은솔개가 돌아오기 전에 다 살폈다: 밸러스트와 못 박힌 빈 상자. 7번 부두의 실마리를 못 박았고, 게다가 빨리 살펴 조수가 거의 움직이지 않았다."
        options:
          - id: read-evidence
            label: 이 증거 보기
            action:
              kind: read
              paths:
                - player/decoy-ship.md
          - id: back
            label: 지도로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank >= 3
          run: evidence-decoy
          on_error: continue
        - when: roll.rank <= 2
          run: miss-berth
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
map:
  pins:
    waterline-trace:
      - 0.22
      - 0.66
    silver-kite:
      - 0.68
      - 0.76
    player:
      - 0.5
      - 0.9
  plan:
    picture: assets/maps/seventh-berth.webp
    pins:
      waterline-trace:
        - 0.27
        - 0.3
      silver-kite:
        - 0.63
        - 0.63
      player:
        - 0.5
        - 0.88
---

기사 은솔개가 사람 하나 없는 배를 지키고 있다. 뱃전에는 수면보다 훨씬 높은 곳에 흔적이 하나 남아 있다.

무엇이 배에 부딪힌 걸까? 흔적의 기록을 읽고 은솔개에게 빈 상자에 대해 묻는 데는 주사위가 필요 없다. 여기서 실마리를 못 박으려면 교대를 틈타 배에 올라 화물칸을 뒤져야 한다. 눈금에 따라 증거를 얻을지, 반쪽 실마리를 얻을지, 은솔개에게 그 자리에서 붙잡힐지가 결정된다.
