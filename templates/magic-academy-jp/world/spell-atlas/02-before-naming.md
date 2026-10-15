---
type: chalk
title: その魔法は何を変える？
choice:
  options:
    - id: action-1
      label: 魔法の組み合わせを書く
    - id: action-2
      label: 提案した魔法の代価を確かめる
  allow_free: true
  free_hint: 動詞、使う物、望む変化、許せる代価をあなたの言葉で。
intent: player/spell-draft.md に実際の提案を保存。妥当な結果と具体的な代価を事前提示し、名付けて施すか、修正するかを待つ。
choice_actions:
  action-1:
    kind: writer
  action-2:
    kind: stage
    slots:
      - id: material-1
        title: 魔法と代価の提案
        required: true
        paths:
          - player/spell-draft.md
---

大きな扉を開くだけが成功ではない。ポケットに収まる星図を作ることも、あなた自身の魔法になる。
