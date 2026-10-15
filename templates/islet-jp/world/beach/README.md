---
type: readme
name: 浜辺
bg: assets/scenes/beach.webp
title: 浜辺
intent: 凪は毎朝ここで網を繕い、魚をより分ける。潮の線には流木がよく打ち上がる。釣りは
  command/go-fishing.yaml、流木を拾って船小屋へ運ぶのは
  command/gather-driftwood.yaml（漁船が一歩直り、健太との仲が深まる。三回で船がトリガーで進水する）、凪と網を繕うのは
  command/mend-nets.yaml。夕方からは夕暮れの絵になる。
choice:
  options:
    - id: fish
      label: 岩場でしばらく釣りをする
    - id: driftwood
      label: 潮の線で流木を拾い、船小屋へ運ぶ
    - id: mend-nets
      label: 腰を下ろして凪と網を繕う
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "fish"
      run: go-fishing
      on_error: continue
    - when: choice.option_id == "driftwood"
      run: gather-driftwood
      on_error: continue
    - when: choice.option_id == "mend-nets"
      run: mend-nets
      on_error: continue
---

白い砂浜が三日月のように弧を描き、岩の間の潮だまりで小さな蟹が横歩きしている。潮の線には、海水で白くなった木がいくつか転がっている。

遠くには、海藻島と鳥岩が霞の中に見え隠れする。
