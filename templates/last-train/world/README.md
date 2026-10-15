---
type: readme
name: Broken Cloud Tunnel · The Last Train, Stopped
bg: assets/scenes/tunnel-train.webp
title: Broken Cloud Tunnel · The Last Train, Stopped
intent: "Overview of the whole train; Act Two starts here. Three acts: Act One
  is in Car 2, the hard-seat car (the entry); in Act Two the player goes from
  this map to Car 3 (sleeper), Car 4 (dining car) and Car 1 (cab), in any order,
  each with a puzzle of its own; Act Three is Car 5, the baggage car, which is
  locked and can only be entered with player/freight-key.md in the bag. The time
  limit is world/departure-clock.md's status.data.left; only the engine's tick
  can change it, and the writer must not change it by hand. Do not open locked
  doors through narration, and do not announce the ending through narration."
states:
- id: turns
  label: "Turns"
  type: number
  initial: 0
  range:
  - 0
  - 999
  hidden: true
choice:
  options:
    - id: go-sleeper
      label: Go to Car 3, the sleeper
    - id: go-dining
      label: Go to Car 4, the dining car
    - id: go-cab
      label: Go to Car 1, the cab
    - id: read-list
      label: Read Xia Cheng's passenger list
      once: true
    - id: ask-awake
      label: Who's still awake at this hour?
      to: companion
      say: At this hour, who else on the train is still awake?
  allow_free: true
choice_actions:
  go-sleeper:
    kind: enter
    target: world/sleeper
  go-dining:
    kind: enter
    target: world/dining-car
  go-cab:
    kind: enter
    target: world/cab
  read-list:
    kind: read
    paths:
      - world/passenger-list.md
map:
  plan:
    picture: assets/maps/tunnel-train.webp
    pins:
      cab:
        - 0.19
        - 0.39
      seated-car:
        - 0.34
        - 0.39
      sleeper:
        - 0.52
        - 0.39
      dining-car:
        - 0.7
        - 0.39
      freight-car:
        - 0.89
        - 0.39
      departure-clock:
        - 0.12
        - 0.2
      passenger-list:
        - 0.34
        - 0.61
      xia-cheng:
        - 0.44
        - 0.6
      player:
        - 0.55
        - 0.6
view: map
---
A little after half past one. Train K7, the last train to Lingkou, has stopped dead in the middle of Broken Cloud Tunnel. There's been a landslide ahead, and only the emergency lights are on in the cars.

Su He, from Car 2, seat 17, is missing; her canvas bag and thermos are still on the seat.

The repair crew says the line reopens at five o'clock sharp. Sleeper, dining car, cab: start wherever you like. The last car, the baggage car, is locked.
