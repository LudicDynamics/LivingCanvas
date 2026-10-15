---
type: readme
name: 마을 광장
bg: assets/scenes/square.webp
title: 마을 광장
intent: 섬사람들은 저녁에 여기 앉아 쉬기를 좋아한다. 일요일 아침엔 장이 서고, 축제(등롱 축제, 수확 잔치)도 여기서 열린다. 미오와
  놀기는 command/play-with-mio.yaml, 카이의 기타 듣기는 command/listen-kai.yaml(카이가 상륙하기
  전에는 그가 없으니, 혼자 잠시 앉아 있는 것이 된다).
choice:
  options:
    - id: play-mio
      label: 미오와 잠시 논다
    - id: listen-kai
      label: 그늘에 앉아 기타 소리가 들리는지 귀를 기울인다
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "play-mio"
      run: play-with-mio
      on_error: continue
    - when: choice.option_id == "listen-kai"
      run: listen-kai
      on_error: continue
---

오래된 녹나무가 그늘을 드리우고, 그 아래 벤치 두 개와 이제 쓰지 않는 우물이 있다. 돌길이 여기서 갈라져 하나는 부두로, 하나는 등대로 오른다.

저녁에 하나의 가게 앞 등이 켜지면 사람들이 천천히 모여든다.
