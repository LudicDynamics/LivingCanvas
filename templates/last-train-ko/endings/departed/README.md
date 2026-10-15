---
type: ending
title: 열차가 떠났다
bg: assets/scenes/ending-departed.webp
passages:
  - when: 'player.hp <= 0'
    text: 당신은 샤청의 부축을 받고서야 열차에서 내렸다. 터널에서 링커우까지 이십오 분 동안, 당신은 18번 창가에 기대 이 밤에 찾아낸 것들을 움켜쥔 채 다시 일어나지 못했다.
  - group: su-he
    when: 'has("player/su-he-testimony.md")'
    text: 쑤허는 당신들이 화물차의 우편 자루 더미 속에서 부축해 꺼냈다. 샤청의 솜코트를 두르고 목숨은 건졌다. 하지만 그 무전은 끝내 걸리지 않았고, 그녀의 말을 들은 사람은 당신들뿐이었다.
  - group: su-he
    text: 역에 도착하고 나서야 승무원이 화물차 우편 자루 더미 속에서 쑤허를 발견했다. 병원으로 옮겨져 목숨은 건졌지만, 그날 밤의 일 가운데 그녀가 기억하는 건 아주 쓴 차 한 잔뿐이었다.
  - group: log
    when: 'has("player/logbook-page.md") || has("world/freight-car/logbook-page.md")'
    text: 일지 페이지는 아직 당신 손에 있다. 하지만 오늘 밤의 무전은 놓쳤고, 그걸 읽어야 할 사람에게 닿기까지는 아직 먼 길이 남았다.
  - group: log
    when: 'has("player/torn-corner.md") || has("world/freight-car/torn-corner.md")'
    text: 일지 페이지는 난로 속으로 들어가고, 당신 손에는 그을린 귀퉁이만 남았다. 십이 년 전 그 적색 신호는 여전히 쑤창겅 한 사람의 이름으로 남았다.
  - group: log
    text: 일지 페이지는 다시는 발견되지 않았다. 십이 년 전 그 적색 신호는 여전히 쑤창겅 한 사람의 이름으로 남았다.
---

5시 정각, 차체가 한 번 흔들리더니 막차가 단운 터널을 빠져나갔다. 이십오 분 뒤 링커우에 도착하자 지국 차량이 이미 승강장에서 기다리고 있었다. 중화이리는 손가방을 들고 가장 먼저 내렸다.
