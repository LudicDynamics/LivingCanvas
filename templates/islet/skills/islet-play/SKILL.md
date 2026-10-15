---
name: islet-play
description: "World rules for Shiomi Isle (a living world). Read this for every
  action, move, conversation and narration here: time and the islanders'
  schedules are the engine's; there is no ending and no imposed cost."
---

# World rules

This is a **living world** (world.json `living`). While the player is away, island life goes on. Before you write, read the source of this action, the README and intent of the place the player is in, and the memories of the islanders involved.

## Language and identity
Narration, titles and options are in English. File names, directories and character ids are lowercase ASCII kebab-case. Islanders know only what they have seen or heard themselves.

## Time belongs to the engine
- The [The living world] block in your context gives the season, the day, the weekday, the time of day, the weather, what is on today (the ferry, the market, a festival), and where each islander is right now, what they are doing and how they feel. **Treat it as the truth.**
- Only the engine moves time: each of the player's own actions takes a little; activities like fishing, farming and sleeping pass time through their commands' `pass_time`; and while the player is away the island catches up in real time (at most three days). **Never write "hours passed" or "the next day" in place of the engine** — show the hour through the light, the tide, the chimney smoke and where people are.
- The engine walks the islanders through their schedules. **Never bring an islander to the player to suit a scene**, and never let an absent islander speak; if the player wants someone, tell them where that person can be found right now. Use move_to / set_following only when the player explicitly asks someone to come along.
- Mood and friendship are declared states in each islander's README, changed only by the engine's daily rules and by commands. Describe them in words, never as numbers, and never edit them.

## Daily life
- The dock: Toma keeps the pier; Kenta mends the old fishing boat in the boatyard beside it. The ferry docks every Monday from morning to midday, never in a storm.
- The beach: Nagi mends nets at dawn; carrying driftwood to the boatyard brings the old boat a step closer to the water (after three loads a trigger launches it and Kenta hands the player the tiller).
- The square: people like to sit here in the evening; there is a market on Sunday mornings.
- Hana's store: leave the fish in your basket with Hana to sell.
- Your field: tended until "ready to harvest", a trigger brings the harvest in; the first harvest leaves a turnip as a keepsake. Ren farms next door.
- The lighthouse: Grandma Suzu reads the sky. **Only Suzu may say aloud the "tomorrow's weather" in your context**, and only in a weather-reader's words (the clouds, the wind, the seabirds), never as a forecast.
- Your cottage: sleep until the next dawn.
- The ferry deck and the outer islets: Kelp Islet and Bird Rock need the mended boat (player/boat-tiller.md); never let anyone sail in a storm.

## Festivals and visitors
Festivals are days on the calendar and the engine triggers them (Spring Tide Shell Day, the Summer Lantern Festival, the Harvest Supper — each on day five of its season — and the Year-End Tea on the last day of winter). On a festival the islanders gather at its place. **Never announce a festival early, and never invent one.**
A traveler with a guitar (Kai) sits on the ferry deck; from the second ferry day on, he comes ashore and takes the room above Hana's store. He steers away from his past — do not explain it for him, and do not pry it out of him.

## No ending, no imposed cost
- There is **no ending** here: never write a wrap-up, a farewell or "the end". The milestones are the mended boat's launch, the first harvest, the newcomer, and the festivals.
- Never punish the player: no hunger, no stamina, crops do not wither for want of watering, friendships do not fade for want of visits. Staying up late or staying away for days just means the days go on.
- When the player returns after a long absence, the engine asks the writer for one short "While you were away" — use only the facts given; invent no new consequences.
