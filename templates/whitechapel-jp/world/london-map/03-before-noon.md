---
type: chalk
title: '正午の前'
status:
  data:
    left: 10
    arrived: "no"
    picture: "no"
    hand: "no"
    address: "no"
choice:
  options:
    - id: confront
      label: '正面から突きつける：「絵が事件より先」と「彼の手が現場にあった」証拠を彼の前に並べる'
      when: 'arrived == "yes" && picture == "yes" && hand == "yes"'
    - id: trap
      label: '計略に乗ったふりをする：赤い封筒を預かり、正午に印刷所の中庭で「イーディスに直接渡す」よう約束させ、そこで待つ'
      when: 'arrived == "yes" && address == "yes"'
    - id: edith-first
      label: 'まずイーディスを：ワトソンに221Bの裏口から連れ出してもらう'
      when: 'arrived == "yes"'
    - id: follow-him
      label: '気づかないふりをして行かせ、そっと後をつける'
      when: 'arrived == "yes"'
intent: 'このカードは正午前の圧力。ウェインが現れる前（arrived が no）は時刻を示すだけで、誰も問題を出さず、推理の提出や書き込みを求めない。プレイヤーが十分に確かめたとき、エンジンがウェイン本人にホームズを呼び止めさせる（command/wayne-turns-up.yaml）。丁寧で頑固、赤い封筒を抱えて立ち去らず、第四の絵の校正刷りをイーディスに直接渡すことにこだわる男として演じる。ワトソンは今すぐ決めろと急かし、イーディスは自分で彼と向き合いたがる。どの道を選べるかは、プレイヤーが実際に見つけたもので決まる。このカードの決定はエンジンが実行する（command/confront-wayne.yaml、set-trap.yaml、edith-first.yaml、follow-wayne.yaml）。作家は地の文で結末を告げず、プレイヤーの代わりに決めない。'
on:
  choice_selected:
    - run: confront-wayne
      when: 'choice.option_id == "confront"'
    - run: set-trap
      when: 'choice.option_id == "trap"'
    - run: edith-first
      when: 'choice.option_id == "edith-first"'
    - run: follow-wayne
      when: 'choice.option_id == "follow-him"'
---

正午まで、あと二時間。調べがうまくいかなければ午前の時間が削られる。正午が先に来れば、四枚目の絵が現実になる。

当て推量も、推理を書くことも要らない。現場、検死室、印刷所、客間を自分の手で調べよう。確かめたことが十分に揃えば、小説を現実の事件に変えている人物はじっとしていられず、自分から姿を現す。そのとき何を握っているかで、打てる手が決まる。
