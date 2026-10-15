---
type: chalk
title: 중화이리를 막아선다
roll_dice:
  type: 2d10
  desc: 중화이리를 막아서고 일지 페이지를 빼앗는다
  expect: ">=11"
choice:
  options:
    - id: back
      label: 일단 주사위를 굴리지 않고, 열차로 돌아간다
choice_actions:
  back:
    kind: enter
    target: map
on:
  roll_resolved:
    - run: train-step
dice_outcomes:
  - min: 2
    max: 4
    harm: serious
    text: 그가 당신보다 빠르다. 일지 페이지가 화로 속으로 들어가고, 당신이 달려들어 빼앗으려 하자 그가 밀어내고, 등이 양철 난로 모서리에 부딪혀 우편 자루 더미 속으로 넘어져 한참 숨을 못 쉰다. 당신은 화로 아귀에서 그을린 모서리 한 조각만 끌어내고, 손등도 데었다. 중화이리는 혼란을 틈타 침대차로 돌아간다. 이 한 조각만으로는 관제사가 믿지 않는다—그의 약판과 식당차 영수증에 기대야 한다.
    options:
      - id: radio
        label: 운전실의 무전기로 가기
        action:
          kind: enter
          target: world/cab
      - id: back
        label: 열차로 돌아가기
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/torn-corner.md
        image: assets/items/torn-corner.webp
        title: 그을린 모서리
        body: 일지 페이지가 타고 남은 모서리 한 조각. "중"자 서명의 반쪽과 "적색 신호 통과……" 몇 글자를 알아볼 수 있다. 중화이리가 무엇인가를 태우려 했다는 것은 말해주지만, 이 한 조각만으로는 링커우 관제사가 인정하지 않는다.
        partial: true
  - min: 5
    max: 10
    harm: light
    text: '그가 일지 페이지를 화로에 밀어 넣었다. 난방도 없는 이 차량에서 당신의 손은 이미 얼어붙어, 화로 아귀에 손을 넣고 두어 번 휘저어야 잡을 수 있었고 손가락에 물집이 났다. 겨우 빼낸 것은 그을린 모서리 한 조각: "중"자 서명의 반쪽과 "적색 신호 통과……" 몇 글자를 알아볼 수 있다. 중화이리는 더 말하지 않고 돌아서 침대차로 돌아갔다. 이 한 조각만으로는 관제사가 믿지 않는다—그의 약판과 식당차 영수증에 기대야 한다.'
    options:
      - id: radio
        label: 운전실의 무전기로 가기
        action:
          kind: enter
          target: world/cab
      - id: back
        label: 열차로 돌아가기
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/torn-corner.md
        image: assets/items/torn-corner.webp
        title: 그을린 모서리
        body: 일지 페이지가 타고 남은 모서리 한 조각. "중"자 서명의 반쪽과 "적색 신호 통과……" 몇 글자를 알아볼 수 있다. 중화이리가 무엇인가를 태우려 했다는 것은 말해주지만, 이 한 조각만으로는 링커우 관제사가 인정하지 않는다.
        partial: true
  - min: 11
    max: 17
    text: '당신이 그보다 먼저 그의 손목을 붙잡았다. 일지 페이지가 우편 자루 위로 떨어진다: 12년 전 11월의 운행 일지, "01:12 관제사 중화이리의 구두 명령 접수: 적색 신호 통과". 중화이리는 손을 놓고 문틀에 기대선다.'
    options:
      - id: radio
        label: 운전실의 무전기로 가기
        action:
          kind: enter
          target: world/cab
      - id: back
        label: 열차로 돌아가기
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/logbook-page.md
        image: assets/items/logbook-page.webp
        title: 쑤창겅의 운행 일지 페이지
        body: '12년 전 11월 7일, 단운 터널 신호소. "01:12 관제사 중화이리의 구두 명령 접수: K7 열차 적색 신호 통과. 본인이 이의를 제기했으나 관제사가 고집함." 아래에는 쑤창겅의 서명이 있다. 사고 이후 이 페이지는 기록 보관소에서 사라졌다.'
  - min: 18
    max: 20
    text: '당신은 일지 페이지를 얻었고, 중화이리는 더 빼앗지 않았다. 그는 우편 자루 위에 앉아 한마디 했다: "나는 12년을 기다렸다, 누군가 와서 묻기를." 눈 깜짝할 사이에 끝났다. 이번 판정은 시간을 쓰지 않는다.'
    options:
      - id: radio
        label: 운전실의 무전기로 가기
        action:
          kind: enter
          target: world/cab
      - id: back
        label: 열차로 돌아가기
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/logbook-page.md
        image: assets/items/logbook-page.webp
        title: 쑤창겅의 운행 일지 페이지
        body: '12년 전 11월 7일, 단운 터널 신호소. "01:12 관제사 중화이리의 구두 명령 접수: K7 열차 적색 신호 통과. 본인이 이의를 제기했으나 관제사가 고집함." 아래에는 쑤창겅의 서명이 있다. 사고 이후 이 페이지는 기록 보관소에서 사라졌다.'
    bonus:
      clock: 1
skill_check:
  skill: fighting
  label: 근접전(몸싸움)
  system: coc
  actor: player
  difficulty: regular
  target: 60
  value: 60
---

중화이리가 비상등을 들고 문 어귀에 서 있다. 회색 모직 코트에 석탄재가 묻어 있다. 그의 오른손은 코트 안주머니 위에 놓여 있다. "젊은이, 문 닫아라, 여기 춥다."

구석의 양철 난로에는 아직 불이 타고 있고, 그는 난로에서 두 걸음밖에 떨어져 있지 않다. 이것이 결정적 한 번의 굴리기다: 일지 페이지를 빼앗으면 철증이 생기고, 빼앗지 못하면 약판과 영수증으로 그를 이 일과 연결해야 한다.

1d100(근접전(몸싸움) 60): 기능 수치 이하면 성공, 낮을수록 좋다.
96–100(5%): 일지 페이지가 타버려 그을린 모서리만 빼내고 시간을 한 걸음 더 쓴다. 그가 당신을 밀어내고 당신은 가벼운 부상을 입는다. 이후에는 약판과 영수증으로 증거를 보충해야 한다.
61–95(35%): 일지 페이지가 타버려 그을린 모서리만 빼내고 시간을 한 걸음 더 쓴다. 얼어붙은 손이 화로 아귀에 데인다(가벼운 부상). 이후에는 약판과 영수증으로 증거를 보충해야 한다.
13–60(48%): 일지 페이지를 빼앗고, 시간을 한 걸음만 쓴다.
1–12(12%): 순식간에 일지 페이지를 빼앗아, 시간을 쓰지 않는다.

같은 카드는 한 번만 굴릴 수 있고, 다시 굴릴 수 없다. 지금 움직이고 싶지 않다면 먼저 열차로 돌아가라.
