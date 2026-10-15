---
type: chalk
title: もう一つの船を探す
choice:
  options:
    - id: action-1
      label: ヴェラに聞く：これらの糸は何を意味する？
    - id: action-2
      label: さらに調査を続ける
  allow_free: true
intent: ここでは記入も提出もしない。プレイヤーが整理したいときは、ヴェラが自分の口調で話す：プレイヤーの鞄に実際にある証拠、それが何を意味するか、次にどのダイスカードへ行くべきか。話すだけで、証拠を渡さず、新しい判定カードを作らず、新しい地点も生成せず、結末も宣言しない。証拠は各地の調査ダイスからのみ得られ、告発はworld/harbor-chart/05-accuse.mdでエンジンによってのみ判定される。
choice_actions:
  action-1:
    kind: character
    character: vera
  action-2:
    kind: enter
    target: world/harbor-chart
---

船の傷と、灯台が消えた時刻。両方を合わせて見れば、霧の中にもう一隻の船がいるかもしれない。

整理したいなら、ヴェラに聞いてみよう——話すのは潮位を消費せず、ダイスも振らない。実際に糸を海図に留めるのは、各地の調査ダイスと海図上の決定的判定だ。振り損ねた糸は、そこの「遠回り」で補おう。
