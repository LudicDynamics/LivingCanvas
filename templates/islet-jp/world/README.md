---
type: readme
name: 潮見島
bg: assets/maps/island.webp
title: 潮見島
intent: 島の全景：桟橋、広場、花の店、あなたの畑、浜、灯台、あなたの小屋、渡し船の甲板、そして船を直すまで行けない海藻島と鳥岩。ここは生きている世界：時刻・天気・祭り・島民の居場所はすべてエンジンが決める（コンテキストの
  [The living world]
  を見よ）。何時間たったと告げない、場面の都合で島民を動かさない、結末を作らない。古い漁船と畑の進み具合はこのファイルで宣言された状態で、コマンドだけが変えられる。
states:
  - id: boat_progress
    label: 古い漁船
    type: number
    initial: 0
    range:
      - 0
      - 3
    shown_as:
      - min: 3
        text: 直って桟橋につながれている
      - min: 2
        text: あと数枚の板を残すだけ
      - min: 1
        text: 半分ほど直り、竜骨がまだ見えている
      - max: 0
        text: 船小屋で伏せられたまま、木材を待っている
  - id: farm_growth
    label: あなたの畑
    type: number
    initial: 0
    range:
      - 0
      - 4
    shown_as:
      - min: 4
        text: 収穫できる
      - min: 3
        text: 膝の高さまで育った
      - min: 2
        text: 若芽が並んで出てきた
      - min: 1
        text: 耕して種をまいたばかり
      - max: 0
        text: まだ荒れ地のまま
  - id: boat_fixed
    label: 船の修理
    type: flag
    initial: false
    hidden: true
  - id: kai_arrived
    label: 海の上陸
    type: flag
    initial: false
    hidden: true
---

潮見島は小さく、桟橋から灯台まで歩いても十五分かからない。島には七人が暮らし、毎週月曜に渡し船が来る。

あなたは村の東の、何年も放っておかれた畑を継ぎに越してきた。誰も急かさない。魚はかかり、種は芽を出し、渡し船は時間どおりに着き、島の人たちはそれぞれの一日を行き来する。あなたがいない間も。
