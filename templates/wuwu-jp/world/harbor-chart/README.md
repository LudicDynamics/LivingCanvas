---
type: gate
name: 港の地図 · 船を調べよう
title: 港の地図 · 船を調べよう
bg: assets/scenes/harbor-chart.webp
requires:
  items:
    - player/commission-letter.md
    - player/investigator-badge.md
blocked: 依頼書と調査員の徽章を両方鞄に入れてくれ。
intent: ここは地点一覧だ。証拠を集める順番は自由。帰り道は港務所。持っていない物品を叙述だけで越えることは許されない。これは閉じた一局だ：結末は三つだけ（告発、見失う、霧に呑まれる）で、結末はエンジンの end によってのみ発動し、作家は結末を宣言せず、beyond-the-fog などで新しい地点も生成しない。
bgVideo: assets/motion/seedance/backgrounds/map.webm
choice:
  options:
    - id: search
      label: 決定的判定：霧の中で第二の航跡を探す（ダイス）
    - id: go-accuse
      label: 告発カードを見る：どの糸が留められているか
  allow_free: true
choice_actions:
  search:
    kind: search
    spot: fog
  go-accuse:
    kind: read
    paths:
      - world/harbor-chart/05-accuse.md
search:
  - id: fog
    skill: navigate
    label: 決定的判定：霧の中で第二の航跡を探す（ダイス）
    title: 決定的判定・霧の中で第二の航跡を探す
    body: |-
      これは一局で最も危険な判定だ：潮が戻る前に、港の最も外側の足場に立ち、霧の中で第二の航跡を見つけ出す。このカードは一度しか振れない。

      この一振りで決まるのは、海図上の糸をその場で留められるか、そして君が霧に呑まれないかどうかだ。出目が良ければ航跡が見え、証拠は直接鞄へ；悪ければ半本の糸（一筋の水痕）しか見えず、遠回りで岸沿いに追わねばならない；最悪なら、灯油があれば燃やして持ちこたえ、灯油がなければこの一局はここで終わる。

      サイコロを振らず、いつでもできること：「もう一つの船を探す」で材料を並べて相談し、手がかりを読み返し、人に聞く。潮水は消費しないが、糸を留めてはくれない。

      1d100（ナビゲート 60）：技能値以下で成功、低いほど良い。
      96–100（5%）：足元が滑り、岩礁に激しく叩きつけられ、ひどい怪我を負い、霧が閉じてくる。**手元に灯油があれば、灯を点けて立て直せるが、その分の油は燃え尽き、何も見えず、遠回りするしかない。点せる油が手元になければ（借りていない、またはすでに燃え尽きた）、霧に呑まれ、この一局はここで終わる。**潮水を余分に一歩消費する。
      61–95（35%）：船は見えず、半本の糸（一筋の航跡）しか得られない。遠回りするしかない。
      13–60（48%）：第二の航跡をはっきりと見て、証拠がかばんに入り、告発カードに✓がつく。
      1–12（12%）：同上、しかも喫水の深さまで見て取れ、この一振りは潮水を消費しない。

      潮水：振るたびに一歩減る（大成功を除く）。96–100に落ちるとさらに一歩減る。遠回りでさらに一歩減る。古い灯台へ行って灯油を一份借りてから戻れば、ずっと確実になる。
    roll_dice:
      type: 2d10
      desc: 霧の中で第二の航跡を探す
      expect: ">=11"
    choice:
      options:
        - id: back
          label: まずダイスを振らず、地図に戻る
    choice_actions:
      back:
        kind: enter
        target: world/harbor-chart
    dice_outcomes:
      - min: 2
        max: 4
        harm: grave
        text: 足元の濡れた石ですべり、あなたは岩礁から転げ落ち、半身が戻りつつある潮水に浸かり、霧が一気に閉じてくる。手元に灯油があれば、灯を点けて立て直せたが、その分の油も燃え尽きた——何も見えず、この糸は留まらず、遠回りするしかない。点せる油が手元になければ、霧に呑まれてしまう。
        options:
          - id: long-way
            label: 遠回り：岸沿いに航跡を追う
            action:
              kind: read
              paths:
                - world/harbor-chart/06-long-way.md
          - id: back
            label: 調査に戻る
            action:
              kind: enter
              target: world/harbor-chart
      - min: 5
        max: 10
        text: 船は見えず、霧の中に一筋の巻き上がる航跡だけが見えた。旧税関隧道の口のあたりから曲がり出て、また霧に消えていく。得たのは半本の糸で、それを留めるには遠回りしなければならない。
        options:
          - id: long-way
            label: 遠回り：岸沿いに航跡を追う
            action:
              kind: read
              paths:
                - world/harbor-chart/06-long-way.md
          - id: back
            label: 調査に戻る
            action:
              kind: enter
              target: world/harbor-chart
      - min: 11
        max: 17
        text: 霧が一瞬薄くなった：第二の航跡が旧税関隧道の口から現れ、無人船をかすめて通り過ぎ、また霧の中へ曲がっていく。海図の上の糸が留まった。
        options:
          - id: read-wake
            label: 第二の航跡を見る
            action:
              kind: read
              paths:
                - player/second-wake.md
          - id: back
            label: 調査に戻る
            action:
              kind: enter
              target: world/harbor-chart
      - min: 18
        max: 20
        text: 霧が晴れると、第二の航跡ははっきりと見えた：旧税関隧道の口から現れ、無人船をかすめて通り過ぎ、喫水が深く、満載の船のようだ。海図の上の糸が留まり、しかも素早く調べたので、潮水はほとんど動かなかった。
        options:
          - id: read-wake
            label: 第二の航跡を見る
            action:
              kind: read
              paths:
                - player/second-wake.md
          - id: back
            label: 調査に戻る
            action:
              kind: enter
              target: world/harbor-chart
    on:
      roll_resolved:
        - when: roll.rank == 1 && has("player/empty-oil-flask.md") || roll.rank == 1 && has("world/harbor-chart/old-lighthouse/lamp-oil.md")
          run: fog-swallows
          on_error: continue
        - when: roll.rank == 1 && has("player/lamp-oil.md")
          run: burn-lamp-oil
          on_error: continue
        - when: roll.rank >= 3
          run: evidence-wake
          on_error: continue
        - when: roll.rank <= 2
          run: miss-chart
          on_error: continue
        - when: roll.rank <= 3
          run: tide-step
          on_error: continue
        - when: roll.rank == 1
          run: tide-surge
          on_error: continue
map:
  pins:
    old-lighthouse:
      - 0.22
      - 0.24
    seventh-berth:
      - 0.42
      - 0.52
    workshop:
      - 0.64
      - 0.62
    player:
      - 0.17
      - 0.87
  plan:
    picture: assets/maps/harbor-chart.webp
    pins:
      old-lighthouse:
        - 0.19
        - 0.12
      seventh-berth:
        - 0.47
        - 0.5
      workshop:
        - 0.85
        - 0.48
      player:
        - 0.16
        - 0.73
---

まず7番埠頭へ行き、船に残った傷を見よう。工房では船の部品を、灯台では灯が消えた時刻を調べられる。順番は君次第だ。

手がかりを読む、人に聞く、材料を並べるのは潮水を消費せず、サイコロも振らない。各地点には一度しか振れない調査サイコロカードが別にあり、出目がその糸をその場で留められるかを決める——成功すれば証拠をかばんに入れる。失敗すれば半本の糸しか得られないか、人を驚かせてしまい、遠回りしてから留め直すことになり、潮水を余分に消費する。海図にはもう一つ、最も危険な決定的判定がある：霧の中で第二の航跡を探す——できれば先に古い灯台へ行って灯油を一份借りておくのがよい。振り損じれば怪我もする——滑る岩礁、舷梯、灯台の階段、戻りつつある潮水——怪我が重すぎれば、告発の段階までたどり着けなくなる。

四本の糸をすべて留めたら、告発カードで告発する。潮が戻る前に告発しなければ、二隻目の船は霧の中へ消えてしまう。
