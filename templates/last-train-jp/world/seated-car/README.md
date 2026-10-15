---
type: gate
name: 2車・硬座車
bg: assets/scenes/seated-car.webp
title: 2車・硬座車
intent: 第一幕（開始地点）。蘇禾の座席（17号）とプレイヤーの座席（18号）はどちらもここ。流れ：夏澄が先に話しかける → プレイヤーがノートを手に取る
  → ダイスで20番の学生に尋ねる（証言はこの一振りで得る。「彼と話しに行く」はもう既定の選択肢にしない）→ 証言を得る → 3号車・寝台車へ、または列車の地図へ戻る（証言を得るか、この車両で四拍過ごすと、選択肢の先頭にこの二つの出口が出る）。学生・周子航（20号）は NPC カード
  zhou-zihang.md（彼をクリックして「話す」）で、witness-account.md
  に書かれたことしか話せない：老人の顔ははっきり見ておらず、グレーのウールコートと白髪交じりの髪しか覚えていない。
status:
  data:
    exits: "no"
choice:
  options:
    - id: go-sleeper
      label: 車尾の寝台車（3号車）へ
      when: exits == "open"
    - id: go-train
      label: 列車全体に戻って見る
      when: exits == "open"
    - id: take-notebook
      label: 蘇禾が残したノートを手に取る
    - id: search
      label: ダイスで、まだ起きている20番の学生に尋ねる
    - id: ask-who
      label: 蘇禾って誰？
      to: xia-cheng
      say: 蘇禾って誰？知り合い？
  allow_free: true
choice_actions:
  go-sleeper:
    kind: enter
    target: world/sleeper
  go-train:
    kind: enter
    target: map
  take-notebook:
    kind: take
    paths:
      - world/seated-car/su-he-notebook.md
  search:
    kind: search
    spot: scene
search:
  - id: scene
    skill: persuade
    label: ダイスで、まだ起きている20番の学生に尋ねる
    title: 近くの乗客に尋ねる
    body: |-
      ほとんどの人が眠っている。起きているのは20号の学生と、あなたに起こされて少し不機嫌な数人だけだ。

      1d100（説得 60）：技能値以下で成功、低いほど良い。
      96–100（5%）：物音が大きすぎて人を驚かせた。手掛かりは半分しか得られず、時間を余分に二歩使う。
      61–95（35%）：うまく運ばなかった。手掛かりは半分しか得られず、時間を余分に一歩使う。
      13–60（48%）：成功。手掛かりを得て、時間は一歩だけ使う。
      1–12（12%）：大成功。手掛かりを得て、さらに少し多く見え、しかも素早くて時間を使わない。

      振るたびに発車が近づく（失敗ならさらに一歩、大成功なら一歩取り戻す）。同じカードは一度しか振れず、振り直しはできない。まだ聞く気になれなければ、振らずにこの車両にとどまる。
    roll_dice:
      type: 2d10
      desc: 近くの乗客に尋ねる
      expect: ">=11"
    choice:
      options:
        - id: back
          label: まだ振らない
    choice_actions:
      back:
        kind: enter
        target: world/seated-car
    dice_outcomes:
      - min: 2
        max: 4
        text: 一人ずつ起こして回るうちに車内は不満の声でいっぱいになり、誰かが車掌を呼びに行ってあなたのことを訴えた。夏澄が皆をなだめ終える頃にはだいぶ時間が経ち、周子航はまたイヤホンをつけてしまった。彼が言うのは、零時五十分ごろ誰かが蘇禾を支えて車尾へ歩いていった、ということだけ。それが誰かは「気づかなかった」。
        options:
          - id: tell
            label: 夏澄に伝える
            to: xia-cheng
            say: 半分だけわかった：誰かが蘇禾を支えて車尾へ行った。誰なのかは言ってくれない。
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: 列車へ戻る
            action:
              kind: enter
              target: map
          - id: to-rear
            label: 車尾へ向かう（3号車・寝台車）
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-half.md
            title: 半分の手掛かり・誰かが彼女を車尾へ
            partial: true
            body: 学生の周子航（2号車20番）：零時五十分ごろ、誰かが蘇禾を支えて車尾へ歩いていった。足取りはふらついていた。それが誰かは、彼は言おうとしなかった。
        cost:
          clock: -1
      - min: 5
        max: 10
        text: 何人に聞いても寝ていたと言う。ようやく周子航にたどり着いたが、見知らぬ相手を警戒していて、零時五十分ごろ誰かが蘇禾を支えて車尾へ行った、足取りがふらついていた、としか言わない。
        options:
          - id: tell
            label: 夏澄に伝える
            to: xia-cheng
            say: 半分だけわかった：誰かが蘇禾を支えて車尾へ行った。誰なのかは言ってくれない。
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: 列車へ戻る
            action:
              kind: enter
              target: map
          - id: to-rear
            label: 車尾へ向かう（3号車・寝台車）
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-half.md
            title: 半分の手掛かり・誰かが彼女を車尾へ
            partial: true
            body: 学生の周子航（2号車20番）：零時五十分ごろ、誰かが蘇禾を支えて車尾へ歩いていった。足取りはふらついていた。それが誰かは、彼は言おうとしなかった。
      - min: 11
        max: 17
        text: あなたは起きている周子航のそばへ直接歩いていく。周子航は言う：停車して間もなく、だいたい零時五十分ごろ、グレーのウールコートを着た白髪交じりの老人が蘇禾を支えて車尾へ歩いていき、彼女が「車酔いした、後ろで風に当たらせてやる」と言った。蘇禾の足取りはふらつき、寝ぼけているようだった。
        options:
          - id: tell
            label: 夏澄に伝える
            to: xia-cheng
            say: わかった：グレーのウールコートを着た白髪交じりの老人が、彼女を支えて車尾へ行った。
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: 列車へ戻る
            action:
              kind: enter
              target: map
          - id: to-rear
            label: 車尾へ向かう（3号車・寝台車）
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-account.md
            title: 周子航の証言
            body: 学生・周子航（2車20号）：だいたい零時五十分ごろ、グレーのウールコートを着た白髪交じりの老人が蘇禾を支えて車尾の方へ歩いていき、彼女が「車酔いした、後ろで風に当たらせてやる」と言った。蘇禾の足取りはふらつき、寝ぼけているようだった。老人の顔ははっきり見ていない。
      - min: 18
        max: 20
        text: あなたは起きている周子航のそばへ直接歩いていく。周子航は言う：停車して間もなく、だいたい零時五十分ごろ、グレーのウールコートを着た白髪交じりの老人が蘇禾を支えて車尾へ歩いていき、彼女が「車酔いした、後ろで風に当たらせてやる」と言った。蘇禾の足取りはふらつき、寝ぼけているようだった。彼はまた、老人から樟脳の匂いがしたとも言う。衣装箱の底の古着のような匂いだ。まっすぐ当たりの相手のところへ行けた。この判定は時間を使わない。
        options:
          - id: tell
            label: 夏澄に伝える
            to: xia-cheng
            say: わかった：グレーのウールコートを着た白髪交じりの老人が、彼女を支えて車尾へ行った。
            action:
              kind: character
              character: xia-cheng
          - id: back
            label: 列車へ戻る
            action:
              kind: enter
              target: map
          - id: to-rear
            label: 車尾へ向かう（3号車・寝台車）
            action:
              kind: enter
              target: world/sleeper
        rewards:
          - path: world/seated-car/witness-account.md
            title: 周子航の証言
            body: 学生・周子航（2車20号）：だいたい零時五十分ごろ、グレーのウールコートを着た白髪交じりの老人が蘇禾を支えて車尾の方へ歩いていき、彼女が「車酔いした、後ろで風に当たらせてやる」と言った。蘇禾の足取りはふらつき、寝ぼけているようだった。老人の顔ははっきり見ていない。
        bonus:
          clock: 1
    on:
      roll_resolved:
        - run: train-step
map:
  plan:
    picture: assets/maps/seated-car.webp
    pins:
      zhou-zihang:
        - 0.78
        - 0.5
      su-he-notebook:
        - 0.41
        - 0.41
      witness-account:
        - 0.67
        - 0.43
      player:
        - 0.5
        - 0.74
view: canvas
passive:
  - id: drag-marks
    skill: spot_hidden
    say: "17番席の下の床に、かかとを引きずった跡がうっすら二本、車両の後ろへ続いている。"
---

硬座車ではほとんどの人が眠っていて、誰かがコートにくるまって寝息を立てている。17号の座席には帆布の鞄と保温ボトル、それに開いたままのノートが一冊置かれている。

二つ隣の座席の学生・周子航はヘッドホンをつけていて、ずっと起きているようだ。
