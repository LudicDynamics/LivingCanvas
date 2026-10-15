# NPC cards

An NPC is a CARD the player can talk to — a witness, a shopkeeper, a guard — not a registered character. It has no agent and no memory of its own: when the player says a line to it, the writer gets an `[NPC Dialogue]` brief and answers once, in the NPC's voice, from the facts the card lists. Use one for anyone who only needs to say what they saw; use `create_char` for someone who must think, move and remember.

The full rules are in `docs/gameplay/NPC物件.md`. The schema is checked when you write the file (a bad card is not written) and by `check:worlds` for templates.

```yaml
---
type: npc
name: 苏禾                                  # display name, in the world's language
avatar: assets/characters/su-he.webp        # optional — omit until the picture EXISTS
gender: female                              # optional: female | male — picks a default voice
voice: gentle-calm                          # optional palette alias (voice-casting skill)
persona: |-                                 # 1–3 short lines: who, how they talk
  被下了药、冻得发抖的年轻女人，说话很轻，断断续续。
knows:                                      # the ONLY facts it may state (1–8 world/… or player/… .md)
  - world/freight-car/su-he-testimony.md
wants: 让人知道日志是被谁拿走的              # optional, one line: what it steers toward
fears: 钟怀礼又回来                          # optional, one line
gives: [take-testimony]                     # optional: option ids on THIS card it may hand over
choice:
  options:
    - { id: take-testimony, label: 记下苏禾的话 }
choice_actions:
  take-testimony: { kind: take, paths: [world/freight-car/su-he-testimony.md] }
---
One or two lines of what the player sees. No facts the knows cards do not hold.
```

Rules:

- Put the card in the place where the person stands (`world/<layer>/<id>.md`), and give it a pin (its file stem) in the layer's `map.plan.pins`. It is never portable.
- `knows` is the whole truth the NPC can tell. A path may be a card that exists, or a declared search / dice find (the NPC then knows the find's reward text before the roll). A card may list itself to make its own body part of what it knows.
- `gives` names options declared on the same card, each with a `choice_actions` entry (or an `on.choice_selected` command). Handing one over runs exactly what clicking that option runs. Never list a key clue whose only rightful source is a dice check.
- `dialogue:` and `given:` are written by the engine; never write them yourself.
- Remove an NPC with `delete`; change what it knows by editing `knows`, not by writing facts into `persona`.
