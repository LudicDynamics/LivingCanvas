---
type: gate
name: 공방 · 배에서 떨어져 나온 부품
title: 공방 · 배에서 떨어져 나온 부품
bg: assets/scenes/workshop.webp
choice:
  options:
    - id: search
      label: 바이스에 고정쇠를 물리고 분해하기(주사위)
    - id: action-1
      label: 배 부품 조사
    - id: action-2
      label: 베라에게 임자 묻기
  allow_free: true
bgVideo: assets/motion/seedance/backgrounds/workshop.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/harbor-chart/workshop/crest-clasp.md
  action-2:
    kind: character
    character: vera
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: mechanical_repair
    label: 바이스에 고정쇠를 물리고 분해하기(주사위)
    title: 베라의 바이스에 고정쇠를 물려 풀어낸다
    body: |-
      고정쇠는 아직 온전하다. 베라의 바이스에 물려 풀어내면 문장 아래 숨은 주문 인장을 볼 수 있을지도 모른다—핀이 부러지면 그 새로 난 긁힘 자국까지 함께 망가질 수도 있다.

      이번 판정으로 결정되는 것은 공방이라는 실마리를 그 자리에서 못 박을 수 있는지, 그리고 고정쇠 자체의 운명이다. 수치가 좋으면 증거가 바로 손에 들어오고, 수치가 나쁘면 반쪽 실마리만 얻는다. 수치가 아주 나쁘면 부품이 망가지고 베라는 몹시 슬퍼할 것이다. 못 박지 못한 실마리는 사라지지 않는다. 카드에 '돌아가기'가 열려 베라에게 주문 장부를 뒤져 달라고 부탁할 수 있지만, 그만큼 조수 한 걸음이 더 든다.

      주사위 없이 언제든 할 수 있는 일: 부품의 설명을 읽고, 베라에게 물주를 묻는다. 조수는 소모되지 않지만, 대신 실마리를 못 박아 주지는 않는다.

      1d100(기계수리 60): 기능 수치 이하면 성공, 낮을수록 좋다.
      96–100(5%): 핀이 부러져 당신의 손을 베고, 베라가 그것을 보았다. 그녀는 이 일을 기억할 것이다. 조수가 한 걸음 더 소모된다. 등유를 가지고 있었다면 당황한 사이에 다 타 버린다. 돌아가기밖에 없다.
      61–95(35%): 녹이 주문 인장을 덮어 반쪽 실마리(문장 탁본)만 얻는다. 돌아가기밖에 없다.
      13–60(48%): 주문 인장을 읽어낸다. 증거 '영주가의 장부 한 장'이 가방에 들어오고, 지목 카드에 ✓가 찍힌다.
      1–12(12%): 위와 같으며, 게다가 빨리 살핀다: 이 판정은 조수를 소모하지 않는다.

      조수: 주사위를 굴릴 때마다 한 걸음 줄어든다(대성공 제외); 96–100에 떨어지면 한 걸음 더 줄어든다; 돌아가기를 하면 한 걸음 더 줄어든다. 이 카드는 한 번만 굴릴 수 있다.
    roll_dice:
      type: 2d10
      desc: 베라의 바이스에 고정쇠를 물려 풀어낸다
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
        text: 핀이 바이스 안에서 부러져 튄 조각이 당신의 손을 베었고, 그 새로 난 긁힘 자국은 부러진 조각과 함께 사라졌다. 베라는 부러진 단면을 물끄러미 바라보며 아무 말도 하지 않았다. 이 실마리는 못 박지 못했다. 부품은 이제 아무 말도 하지 못한다. 돌아가기밖에 없다. 베라에게 주문 장부를 뒤져 달라 청하자.
        options:
          - id: long-way
            label: "돌아가기: 베라에게 주문 장부를 뒤져 달라 청하기"
            action:
              kind: read
              paths:
                - world/harbor-chart/workshop/05-long-way.md
          - id: back
            label: 지도로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: 고정쇠는 열렸지만 주문 인장은 녹에 덮여 있었다. 당신은 영주가의 문장만 탁본했다—어느 집안인지는 알 수 있어도 어느 배인지는 알 수 없다. 당신이 얻은 것은 반쪽 실마리다. 못 박으려면 돌아가야 한다.
        options:
          - id: long-way
            label: "돌아가기: 베라에게 주문 장부를 뒤져 달라 청하기"
            action:
              kind: read
              paths:
                - world/harbor-chart/workshop/05-long-way.md
          - id: back
            label: 지도로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: 녹이 한 겹씩 벗겨지자 문장 아래의 주문인이 또렷하게 드러났다. 영주가의 장부에 기록되어 있고, 항구 선박 명부에 없는 배에 주문된 것이었다. 공방의 실마리가 못 박혔다.
        options:
          - id: read-evidence
            label: 이 증거 보기
            action:
              kind: read
              paths:
                - player/ledger-page.md
          - id: back
            label: 지도로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: 바이스를 풀자 주문인이 드러났고, 새로 난 긁힌 자국의 높이마저 7번 부두의 긁힌 자국과 맞아떨어졌다. 공방의 실마리가 못 박혔고, 게다가 빨리 살폈기에 조수는 거의 움직이지 않았다.
        options:
          - id: read-evidence
            label: 이 증거 보기
            action:
              kind: read
              paths:
                - player/ledger-page.md
          - id: back
            label: 지도로 돌아가기
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank >= 3
          run: evidence-ledger
          on_error: continue
        - when: roll.rank <= 2
          run: miss-workshop
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
    crest-clasp:
      - 0.47
      - 0.52
    player:
      - 0.42
      - 0.88
  plan:
    picture: assets/maps/workshop.webp
    pins:
      crest-clasp:
        - 0.5
        - 0.39
      player:
        - 0.46
        - 0.72
---

키에서 떨어져 나온 부품 하나가 등 아래 작업대에 놓여 있다. 베라가 거기 둔 것이다. 부품에는 영주 문장이 찍혀 있다.

어느 배에서 나왔는지가 곧 단서다. 부품 설명을 읽고 베라에게 임자를 묻는 데는 주사위가 필요 없다. 여기서 실마리를 못 박으려면 바이스에 고정쇠를 물리고 분해해야 한다—판정에 따라 주문 각인을 읽어내거나, 문장만 탁본하거나, 핀을 부러뜨린다.
