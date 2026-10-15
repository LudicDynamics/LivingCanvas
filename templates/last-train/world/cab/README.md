---
type: gate
name: Car 1 · Cab
bg: assets/scenes/cab.webp
title: Car 1 · Cab
intent: "One thread of Act Two (the cab: the repair notice and the radio).
  Driver Old Qin minds the radio. Old Qin is NPC card lao-qin.md (click him to
  \"Talk\"): he only knows that at 12:42 AM he got off with a lantern to check
  the landslide and returned at 1:05 AM, that the Car 5 key was still on the
  board before he got off, and that its hook is empty now. 02-radio-report.md is
  the only convergence point (Car 5's 06-radio-relay.md runs the same command):
  only the end in command/report-truth.yaml can finish this run, and the writer
  must not announce the ending in its place."
choice:
  options:
    - id: read-notice
      label: Read the repair notice
      once: true
    - id: radio
      label: Report to the Lingkou dispatcher by radio
    - id: talk-laoqin
      label: Talk with Old Qin
    - id: ask-proof
      label: Dispatch only trusts evidence… do we have enough?
      to: companion
      say: Dispatch only trusts evidence. Is what we have enough?
  allow_free: true
choice_actions:
  read-notice:
    kind: read
    paths:
      - world/cab/repair-notice.md
  radio:
    kind: read
    paths:
      - world/cab/02-radio-report.md
  talk-laoqin:
    kind: talk
    npc: world/cab/lao-qin.md
map:
  plan:
    picture: assets/maps/cab.webp
    pins:
      lao-qin:
        - 0.66
        - 0.46
      repair-notice:
        - 0.3
        - 0.25
      02-radio-report:
        - 0.51
        - 0.21
      player:
        - 0.5
        - 0.87
view: canvas
---
It's a little warmer in the cab; only the radio's small green light is on over the dashboard. Driver Old Qin has just come back from the front of the tunnel, his boots grey with crushed stone.

A key board hangs on the wall, every key tied to a red tag; the hook for "Car 5 · Baggage" is empty. The radio reaches the Lingkou dispatcher directly — but the dispatcher only trusts evidence.
