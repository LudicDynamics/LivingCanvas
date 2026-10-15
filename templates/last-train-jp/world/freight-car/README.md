---
type: gate
name: 5号車・荷物車
bg: assets/scenes/freight-car.webp
title: 5号車・荷物車
requires:
  items:
    - player/freight-key.md
blocked: 荷物車の扉は鍵がかかっている。「5号車」の赤札が付いた鍵が必要だ——運転室の鍵板からは消えている。他の車両を探してみろ。
intent: 第三幕。蘇禾がここにいる：薬を盛られ、凍えて震えているが、生きている。彼女はNPCカードsu-he.md（彼女をクリックして「会話」）。su-he-testimony.mdの中のことしか話せず、差し出せるのは彼女の証言だけ：自分がどうやって入ったか分からず、日誌のページがどこへ行ったかも分からない。決定的判定は04-confront-dice.md（鐘懐礼を止める）：60以下でlogbook-pageを得る、10以下ではtorn-cornerしか得られない。判定以外の叙述で日誌のページを出してはならない。
choice:
  options:
    - id: take-testimony
      label: 蘇禾を起こして、話を聞く
    - id: confront
      label: 鐘懐礼が扉口を塞いでいる——サイコロで彼を止める
    - id: back
      label: 列車へ戻る
    - id: warm-her
      label: まず彼女を温めよう
      to: companion
      say: 夏澄、綿入れのコートを彼女に。まず温めてあげよう。
  allow_free: true
choice_actions:
  take-testimony:
    kind: take
    paths:
      - world/freight-car/su-he-testimony.md
  confront:
    kind: read
    paths:
      - world/freight-car/04-confront-dice.md
  back:
    kind: enter
    target: map
map:
  plan:
    picture: assets/maps/freight-car.webp
    pins:
      su-he:
        - 0.24
        - 0.52
      su-he-testimony:
        - 0.35
        - 0.45
      04-confront-dice:
        - 0.83
        - 0.25
      player:
        - 0.5
        - 0.78
      06-radio-relay:
        - 0.62
        - 0.2
view: canvas
---

荷物車には暖房がなく、吐く息は白い。郵袋が小山のように積まれ、隅の鉄板ストーブにはまだ少し火が燃えている。

郵袋の間に人が一人丸まっている——蘇禾だ。唇は紫だが、まだ息がある。

あなたの背後で、車の扉がまた音を立てた。
