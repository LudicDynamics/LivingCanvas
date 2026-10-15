---
type: readme
name: Shiomi Isle
bg: assets/maps/island.webp
title: Shiomi Isle
intent: "The whole island: the dock, the square, Hana's store, your field, the
  beach, the lighthouse, your cottage, the ferry deck, and Kelp Islet and Bird
  Rock, reachable only once the boat is mended. This is a living world: the
  time, weather, festivals and where each islander is are the engine's (see [The
  living world] in your context). Never announce that hours pass, never move an
  islander to suit a scene, never invent an ending. The old boat and the field
  are states declared in this file; only commands change them."
states:
  - id: boat_progress
    label: The old boat
    type: number
    initial: 0
    range:
      - 0
      - 3
    shown_as:
      - min: 3
        text: mended and moored at the dock
      - min: 2
        text: only a few planks to go
      - min: 1
        text: half patched, keel still showing
      - max: 0
        text: upturned in the boatyard, waiting for wood
  - id: farm_growth
    label: Your field
    type: number
    initial: 0
    range:
      - 0
      - 4
    shown_as:
      - min: 4
        text: ready to harvest
      - min: 3
        text: knee-high and thriving
      - min: 2
        text: rows of green shoots
      - min: 1
        text: freshly dug and sown
      - max: 0
        text: still a patch of weeds
  - id: boat_fixed
    label: Boat mended
    type: flag
    initial: false
    hidden: true
  - id: kai_arrived
    label: Kai has landed
    type: flag
    initial: false
    hidden: true
---

Shiomi is small; you can walk from the dock to the lighthouse in a quarter of an hour. Seven people live here, and a ferry comes every Monday.

You have come to take over the field on the east side of the village, left wild for years. Nobody is rushing you. Fish will bite, seeds will sprout, the ferry will come on time, and the islanders will come and go about their own days — even while you are away.
