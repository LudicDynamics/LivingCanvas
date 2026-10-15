---
type: gate
name: 1号車 · 運転室
bg: assets/scenes/cab.webp
title: 1号車 · 運転室
intent: 第二幕の筋の一つ（運転室：復旧通知と無線）。運転士の秦じいが無線を守っている。秦じいは NPC カード
  lao-qin.md（彼をクリックして「話す」）：彼が知っているのは、0時42分に提灯を持って下車して土砂崩れを見に行き、1時5分に戻ったこと、下車前には5号車の鍵がまだ板に掛かっていて、今はフックが空だということだけ。02-radio-report.md
  が唯一の収束点（5号車の 06-radio-relay.md も同じコマンドを実行する）：command/report-truth.yaml の end
  だけがこの一局を終わらせられる。作家が代わりに結末を宣言しないこと。
choice:
  options:
    - id: read-notice
      label: 復旧通知を読む
      once: true
    - id: radio
      label: 無線で嶺口指令に報告する
    - id: talk-laoqin
      label: 秦じいと話す
    - id: ask-proof
      label: 指令は証拠しか信じない……手持ちで足りる？
      to: companion
      say: 指令は証拠しか信じない。わたしたちの手持ちで、足りるかな？
  allow_free: true
choice_actions:
  read-notice:
    kind: read
    paths:
      - world/cab/repair-notice.md
  radio:
    kind: read
    paths:
      - world/cab/02-radio-report.md
  talk-laoqin:
    kind: talk
    npc: world/cab/lao-qin.md
map:
  plan:
    picture: assets/maps/cab.webp
    pins:
      lao-qin:
        - 0.66
        - 0.46
      repair-notice:
        - 0.3
        - 0.25
      02-radio-report:
        - 0.51
        - 0.21
      player:
        - 0.5
        - 0.87
view: canvas
---
運転室の中は少し暖かく、計器盤の上では無線の小さな緑のランプだけが点いている。運転士の秦じいはトンネルの前方から戻ったばかりで、靴は砕石の粉だらけだ。

壁には鍵板が掛かっていて、どの鍵にも赤い札が結ばれている。「5号車 荷物車」のフックは空だ。無線は嶺口指令に直接つながる——だが指令は証拠しか信じない。
