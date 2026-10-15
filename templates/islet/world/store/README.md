---
type: readme
name: Hana's General Store
bg: assets/scenes/store.webp
title: Hana's General Store
intent: "The only shop on the island: a little of everything, and it takes the
  islanders' fish and vegetables on consignment; Hana hears every piece of news
  first. Leaving your catch with Hana runs command/sell-fish.yaml (empties your
  basket, deepens your friendship with Hana). On rainy days Kenta and Ren
  shelter here."
choice:
  options:
    - id: sell-fish
      label: Leave your catch with Hana to sell
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "sell-fish"
      run: sell-fish
      on_error: continue
---

The doorbell jingles. Shelves run floor to ceiling — tins, seeds, rope, flashlights, jars of pickled plums. A ledger crammed with handwriting lies open by the register.

There is always a pot of hot tea behind the counter.
