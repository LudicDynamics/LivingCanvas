---
type: letter
title: 封印された封筒
visual: envelope
portable: true
choice:
  options:
    - id: action-1
      label: 封筒を開ける
    - id: action-2
      label: 外観を調べる
status:
  data:
    opened: false
intent: 開けることで短く具体的なメッセージが見えます。完全なメッセージ、公のContext、opened=trueを保持します。外見を見ただけでは開封していません。再訪時は同じテキストを保持します。
choice_actions:
  action-1:
    kind: writer
  action-2:
    kind: reply
    text: 封筒の文字は見慣れない手書き。封印は intact のまま。外見を見ただけでは開けたり名前は分かりません。
---

見慣れない筆跡で宛名が書かれた封筒。

## 状況
手紙はまだ開封されていません。
