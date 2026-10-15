---
type: ending
title: 列車は発車した
bg: assets/scenes/ending-departed.webp
passages:
  - when: 'player.hp <= 0'
    text: あなたは夏澄に支えられて列車を降りた。トンネルから嶺口までの二十五分、18番の窓にもたれたまま、この夜に見つけたものを握りしめて、二度と立ち上がれなかった。
  - group: su-he
    when: 'has("player/su-he-testimony.md")'
    text: 蘇禾は、あなたたちが荷物車の郵袋の山から助け出した。夏澄の綿入れのコートにくるまれて、命は助かった。けれどあの無線は最後まで入らず、彼女の話を聞いたのはあなたたちだけだった。
  - group: su-he
    text: 駅に着いてから、ようやく乗務員が荷物車の郵袋の山の中で蘇禾を見つけた。病院に運ばれて命は助かったが、あの夜のことで彼女が覚えているのは、ひどく苦いお茶が一杯だけだった。
  - group: log
    when: 'has("player/logbook-page.md") || has("world/freight-car/logbook-page.md")'
    text: 日誌のページは、まだあなたの手の中にある。けれど今夜の無線には間に合わなかった。読むべき人の手に届くまで、まだ長い道のりがある。
  - group: log
    when: 'has("player/torn-corner.md") || has("world/freight-car/torn-corner.md")'
    text: 日誌のページはストーブにくべられ、あなたの手に残ったのは焦げた切れ端だけだった。十二年前のあの赤信号は、やはり蘇長庚ひとりの名の下に記されたままである。
  - group: log
    text: 日誌のページは二度と見つからなかった。十二年前のあの赤信号は、やはり蘇長庚ひとりの名の下に記されたままである。
---

五時ちょうど、車体がぐらりと揺れ、終電は断雲トンネルを抜けた。二十五分後に嶺口に着くと、分局の車がもうホームで待っていた。鐘懐礼はトランクを提げて真っ先に降りていった。
