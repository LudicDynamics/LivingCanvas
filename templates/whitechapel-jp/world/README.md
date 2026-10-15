---
type: readme
name: 221B · 次の事件を止めよう
title: 221B · 次の事件を止めよう
bg: assets/backgrounds/intro.webp
intent: world/watson-letter.md と fourth-illustration.md を読んで示す。受諾して取ると言われたら world/blue-brass-cap.md を player/blue-brass-cap.md へ move。次は倫敦地図から第三現場へ案内。真相はまだ明かさない。正午は物語上の圧力で、実時間の読書時間に罰を課さない。
choice:
  options:
    - id: action-1
      label: 手紙と四枚目の絵を読む
    - id: action-2
      label: 依頼を受け、画筒の蓋を持つ
bgVideo: assets/motion/seedance/backgrounds/intro.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/watson-letter.md
      - world/fourth-illustration.md
  action-2:
    kind: take
    paths:
      - world/blue-brass-cap.md
map:
  plan:
    picture: assets/maps/baker-street-sitting-room.webp
    pins:
      watson-letter: [0.6, 0.53]
      fourth-illustration: [0.68, 0.58]
      blue-brass-cap: [0.6, 0.63]
      london-map: [0.75, 0.18]
      watson: [0.4, 0.45]
      player: [0.21, 0.77]
---

あなたはシャーロック・ホームズ。ワトソンが外套を濡らしたまま、まっすぐここへ来て居間に立っている。

「患者のイーディスは小説家だ。彼女の小説と同じ事件が三件続けて起きた。次の事件は今日の正午。誰かが小説をまねている。彼女を助けてほしい」。

やることは二つ。誰が小説をまねているか調べること。そして、今日の四件目を防ぐことです。まず手紙と四枚目の絵を読み、画筒の蓋を持ってロンドンの地図へ出ましょう。イーディスはこの家の客間にいます。
