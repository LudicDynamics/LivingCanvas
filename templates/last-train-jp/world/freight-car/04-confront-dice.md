---
type: chalk
title: 鐘懐礼を止める
roll_dice:
  type: 2d10
  desc: 鐘懐礼を止め、日誌のページを奪い取る
  expect: ">=11"
choice:
  options:
    - id: back
      label: まずダイスを振らず、列車へ戻る
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
    text: 彼の方が速かった。日誌のページは炉膛へ入り、あなたは飛びかかって奪おうとしたが、彼に突き飛ばされ、背中を鉄板ストーブの角に打ちつけ、郵袋の山に倒れ込み、しばらく息ができなかった。あなたは炉口から焦げた一角を引きちぎっただけ、手の甲もやけどした。鐘懐礼はその隙に寝台車へ戻った。この一角だけでは、指令は信じない——彼の薬板と食堂車のレシートがまだ必要だ。
    options:
      - id: radio
        label: 運転室の無線へ
        action:
          kind: enter
          target: world/cab
      - id: back
        label: 列車へ戻る
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/torn-corner.md
        image: assets/items/torn-corner.webp
        title: 焦げた一角
        body: 日誌のページが焼け残った一角。「鐘」の署名の半分と、「赤信号放……」の数字が読み取れる。鐘懐礼が何かを焼き捨てようとしたことを示すが、この一角だけでは嶺口の指令は認めない。
        partial: true
  - min: 5
    max: 10
    harm: light
    text: 彼は日誌のページをストーブに押し込んだ。あなたの手はこの暖房のない車両でとっくに凍りついており、炉口に手を入れて二度掴んでようやく掴み、指にまめができたが、奪えたのは焦げた一角だけ：それでも「鐘」の署名の半分と、「赤信号放……」の数字が読み取れる。鐘懐礼はそれ以上何も言わず、振り返って寝台車へ戻った。この一角だけでは、指令は信じない——彼の薬板と食堂車のレシートがまだ必要だ。
    options:
      - id: radio
        label: 運転室の無線へ
        action:
          kind: enter
          target: world/cab
      - id: back
        label: 列車へ戻る
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/torn-corner.md
        image: assets/items/torn-corner.webp
        title: 焦げた一角
        body: 日誌のページが焼け残った一角。「鐘」の署名の半分と、「赤信号放……」の数字が読み取れる。鐘懐礼が何かを焼き捨てようとしたことを示すが、この一角だけでは嶺口の指令は認めない。
        partial: true
  - min: 11
    max: 17
    text: あなたは彼より先に手首を押さえた。日誌のページは郵袋の上に落ちた：12年前11月の運転日誌、「01:12 指令鐘懐礼の口令を受ける：赤信号放行」。鐘懐礼は手を離し、扉枠にもたれた。
    options:
      - id: radio
        label: 運転室の無線へ
        action:
          kind: enter
          target: world/cab
      - id: back
        label: 列車へ戻る
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/logbook-page.md
        image: assets/items/logbook-page.webp
        title: 蘇長庚の運転日誌のページ
        body: 12年前11月7日、断雲トンネル信号所。「01:12 指令鐘懐礼の口令を受ける：K7列車赤信号放行。本人は異議を唱えたが、指令は主張を貫いた。」その下に蘇長庚の署名がある。事故の後、このページは記録から消えた。
  - min: 18
    max: 20
    text: あなたは日誌のページを手に入れ、鐘懐礼はもう奪わなかった。彼は郵袋の上に座り、一言だけ言った：「十二年待った。誰かが訊きに来るのを待っていた。」ほんの一瞬の出来事だった。この判定は時間を消費しない。
    options:
      - id: radio
        label: 運転室の無線へ
        action:
          kind: enter
          target: world/cab
      - id: back
        label: 列車へ戻る
        action:
          kind: enter
          target: map
    rewards:
      - path: world/freight-car/logbook-page.md
        image: assets/items/logbook-page.webp
        title: 蘇長庚の運転日誌のページ
        body: 12年前11月7日、断雲トンネル信号所。「01:12 指令鐘懐礼の口令を受ける：K7列車赤信号放行。本人は異議を唱えたが、指令は主張を貫いた。」その下に蘇長庚の署名がある。事故の後、このページは記録から消えた。
    bonus:
      clock: 1
skill_check:
  skill: fighting
  label: 近接戦闘（組みつき）
  system: coc
  actor: player
  difficulty: regular
  target: 60
  value: 60
---

鐘懐礼は非常灯を提げて扉口に立っている。グレーのウールコートには石炭の灰が付いている。彼の右手はコートの内ポケットに当てられている。「若いの、扉を閉めろ、ここは寒い。」

隅の鉄板ストーブにはまだ火が燃えており、彼はストーブからわずか二歩のところにいる。これが決定的な一振りだ：日誌のページを奪えば、鉄証が手に入る；奪えなければ、薬板とレシートで彼とこの件を結びつけるしかない。

1d100（近接戦闘（組みつき） 60）：技能値以下で成功、低いほど良い。
96–100（5%）：日誌のページは焼かれ、焦げた一角しか奪えず、時間を余分に一歩消費する；彼はあなたを突き飛ばし、あなたは軽くない傷を負う。その後は薬板とレシートで証拠を補わねばならない。
61–95（35%）：日誌のページは焼かれ、焦げた一角しか奪えず、時間を余分に一歩消費する；凍りついた手は炉口でやけどする（軽傷）。その後は薬板とレシートで証拠を補わねばならない。
13–60（48%）：日誌のページを奪い、時間は一歩だけ消費する。
1–12（12%）：一瞬で日誌のページを奪い、時間を消費しない。

同じカードは一度しか振れず、振り直しはできない。今は手を出したくないなら、まず列車へ戻れ。
