---
type: gate
name: 外れ島・鳥岩
bg: assets/scenes/bird-rock.webp
title: 外れ島・鳥岩
requires:
  items:
    - player/boat-tiller.md
blocked: 鳥岩は四方が崖と暗礁で、船でなければ近づけない。まず健太と古い漁船を直そう。
intent: 海鳥の島。船を直してから来られる。春と夏には何千羽もの海鳥が崖に巣をかける。鈴ばあちゃんは若いころよくここに鳥を数えに来た。探検は
  command/explore-islet.yaml。鳥の群れを驚かせず、危険も置かない。
choice:
  options:
    - id: explore
      label: 崖の下をゆっくり歩き、海鳥を眺める
    - id: back
      label: 船で渡し船の甲板に戻る
  allow_free: true
choice_actions:
  back:
    kind: enter
    target: world/ferry
on:
  choice_selected:
    - when: choice.option_id == "explore"
      run: explore-islet
      on_error: continue
---

黒い岩壁には巣がびっしりと並び、海鳥の声が波の音をかき消す。岩の割れ目には小さな白い花の草が茂っている。

ここからは潮見島の全体が見え、灯台はマッチ棒ほどの小ささだ。
