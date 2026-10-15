---
type: gate
name: Car 4 · Dining Car
bg: assets/scenes/dining-car.webp
title: Car 4 · Dining Car
intent: "One thread of Act Two (the dining car's puzzle: whose were the two teas
  at table 4, and where did the Car 5 key go?). Cook Old He is dozing; he is NPC
  card lao-he.md (click him to \"Talk\"): he remembers that a bit past eleven,
  table 4 was an old gentleman and a young woman, and the woman showed the old
  gentleman a yellowed piece of paper; after the stop he fell asleep and saw
  nothing. The Car 5 key is hidden in the coal scuttle beside the water boiler,
  and can only be found through the dice card. If the search falls short
  (61–100), the Long Way Around card 05-long-way.md opens
  (command/miss-dining.yaml); choosing it puts the key in the bag for one more
  step of time (command/long-way-dining.yaml)."
choice:
  options:
    - id: take-bill
      label: Take the receipt from table 4
    - id: read-teacups
      label: Look at the two teacups on table 4
      once: true
    - id: search
      label: Roll to search the dining car
    - id: talk-laohe
      label: Talk with Old He
    - id: ask-cups
      label: Two teas… whose was the other one?
      to: companion
      say: Two cups of tea… who drank the other one?
  allow_free: true
choice_actions:
  take-bill:
    kind: take
    paths:
      - world/dining-car/tea-bill.md
  read-teacups:
    kind: read
    paths:
      - world/dining-car/two-teacups.md
  search:
    kind: search
    spot: scene
  talk-laohe:
    kind: talk
    npc: world/dining-car/lao-he.md
search:
  - id: scene
    skill: spot_hidden
    label: Roll to search the dining car
    title: Search the dining car
    body: >-
      Counter, tables, water boiler, coal scuttle. Old He is still dozing.


      1d100 (Spot Hidden 60): roll at or under your skill; lower is better.

      96–100 (5%): You blunder in the dark and get hurt, not lightly. You only
      get half a clue, and it costs one extra step of time; a Long Way Around
      opens that still gets the key, for one more step.

      61–95 (35%): The search goes badly. You only get half a clue, and it costs
      one extra step of time; a Long Way Around opens that still gets the key,
      for one more step.

      13–60 (48%): Success. You get the clue; it costs only one step of time.

      1–12 (12%): Great success. You get the clue, notice a little more, and are
      so quick it costs no time.


      Each roll brings departure one step closer (failure adds one more step; a
      great success wins it back). The same card can only be rolled once; no
      rerolls. If you do not want to spend time, do not roll yet and return to
      the train.
    roll_dice:
      type: 2d10
      desc: Search the dining car
      expect: ">=11"
    choice:
      options:
        - id: back
          label: Don't roll yet; go back to the train
    choice_actions:
      back:
        kind: enter
        target: map
    dice_outcomes:
      - min: 2
        max: 4
        harm: serious
        text: "You first feel your way to the car coupling: the emergency light does not
          reach there, and as you step across the swaying gangway plate to look
          at the doorway of Car 5, your foot slips and your shin slams hard
          against the coupler. The noise wakes Old He, who grabs you and asks
          question after question, and shoos you out before you get past the
          counter. On the way out you notice that the coal ash by the scuttle
          beside the water boiler has been stirred up; you never got to look
          inside."
        options:
          - id: long-way
            label: "Long Way Around: tip out the coal scuttle"
            action:
              kind: read
              paths:
                - world/dining-car/05-long-way.md
          - id: back
            label: Return to the train
            action:
              kind: enter
              target: map
        rewards:
          - path: world/dining-car/freight-key-half.md
            title: Half a clue · Stirred coal ash
            partial: true
            body: Someone stirred up the coal ash by the scuttle beside the dining car's
              water boiler before Old He woke. Whatever is in the scuttle, you
              have not seen it.
      - min: 5
        max: 10
        text: You search the counter and under the tables first, and by the time you
          think of the water boiler, Old He has woken and is shovelling coal
          into it himself. You only notice that the coal ash by the scuttle had
          been stirred up before he got there.
        options:
          - id: long-way
            label: "Long Way Around: tip out the coal scuttle"
            action:
              kind: read
              paths:
                - world/dining-car/05-long-way.md
          - id: back
            label: Return to the train
            action:
              kind: enter
              target: map
        rewards:
          - path: world/dining-car/freight-key-half.md
            title: Half a clue · Stirred coal ash
            partial: true
            body: Someone stirred up the coal ash by the scuttle beside the dining car's
              water boiler before Old He woke. Whatever is in the scuttle, you
              have not seen it.
      - min: 11
        max: 17
        text: The coal ash beside the scuttle has been stirred up by someone. In the
          coal scuttle beside the water boiler, buried under the coal, is a key
          with a red tag reading "Car 5 Baggage Car." Someone did not dare hang
          it back in the cab, so they tossed it here.
        options:
          - id: back
            label: Return to the train
            action:
              kind: enter
              target: map
          - id: to-freight
            label: Go to the baggage car at the rear
            action:
              kind: enter
              target: world/freight-car
        rewards:
          - path: world/dining-car/freight-key.md
            image: assets/items/freight-key.webp
            title: Red-tagged Car 5 key
            body: A key found in the coal scuttle beside the dining car's water boiler; the
              red tag reads "Car 5 Baggage Car." Someone did not dare hang it
              back in the cab, so they threw it here. With it, you can open the
              baggage car at the rear.
      - min: 18
        max: 20
        text: 'The coal ash beside the scuttle has been stirred up by someone. In the
          coal scuttle beside the water boiler, buried under the coal, is a key
          with a red tag reading "Car 5 Baggage Car." Someone did not dare hang
          it back in the cab, so they tossed it here. There is also half a shoe
          print in the coal ash, from an old-style hard-soled leather shoe. You
          went straight to the scuttle: this search costs no time.'
        options:
          - id: back
            label: Return to the train
            action:
              kind: enter
              target: map
          - id: to-freight
            label: Go to the baggage car at the rear
            action:
              kind: enter
              target: world/freight-car
        rewards:
          - path: world/dining-car/freight-key.md
            image: assets/items/freight-key.webp
            title: Red-tagged Car 5 key
            body: A key found in the coal scuttle beside the dining car's water boiler; the
              red tag reads "Car 5 Baggage Car." Someone did not dare hang it
              back in the cab, so they threw it here. With it, you can open the
              baggage car at the rear.
        bonus:
          clock: 1
    on:
      roll_resolved:
        - run: train-step
        - when: roll.rank <= 2
          run: miss-dining
          on_error: continue
map:
  plan:
    picture: assets/maps/dining-car.webp
    pins:
      lao-he:
        - 0.7
        - 0.56
      tea-bill:
        - 0.39
        - 0.4
      two-teacups:
        - 0.42
        - 0.32
      freight-key:
        - 0.88
        - 0.4
      player:
        - 0.5
        - 0.74
view: canvas
---

A faint smell of cooking still hangs in the dining car. Old He, the cook, is dozing on the counter, and the water boiler gurgles at the far end.

Two teacups on table 4 haven't been cleared, and a receipt is tucked under the corner of the table. Past it lies the locked baggage car.
