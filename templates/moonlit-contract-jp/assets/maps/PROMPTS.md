# The Moonlit Pact — map prompts

One drawn map per layer, for map mode (docs/ux/24). The opening picture in
`assets/backgrounds/` shows where you stand; this shows the place **from
above**, so the world reads as a world and not as a single picture.

This world has one authored layer. Later places (`world/moonlit-courtyard` and
onward) are generated during play and get no planned map here.

## How to use this file

1. Generate the image below. Save it at the **Output** path, in all three
   editions (`templates/moonlit-contract`, `templates/moonlit-contract-zh`,
   `templates/moonlit-contract-jp` — the map carries no text, so one picture
   serves all three).
2. That's it. The layer README already names the file under `map.plan.picture`,
   so map mode shows it the moment it exists. Until then it falls back to the
   opening picture.
3. The generator will not hit the spots exactly. After generating, ask Claude to
   look at the image and move the pins in `map.plan.pins` onto what was drawn.

## Rules for every map in this world

- 16:9, 2048×1152 (at least 1600×900). WebP, or PNG to convert later.
- **No text, letters, numbers, labels, legends, compass roses with letters,
  grids, UI, frames or watermarks.** The summoning circle is geometric lines
  and moon shapes only, never letters. The game draws its own labels.
- Every place, object and person in the pin table must be **drawn as a clear,
  readable landmark at that spot**. Keep 6% clear margin at the edges.
- Leave the bottom-centre strip calm: the story caption and the player sit there.
- Never draw people. Where a character stands, leave clear floor; the game
  draws them.
- The observatory is a straight top-down floor plan, like a tabletop RPG
  battle map. Keep the look of `opening.png`: ruined grey stone on a sea cliff,
  ivy, a broken bronze astrolabe, a faint lavender summoning circle on the
  floor, a pale crescent moon, mist over the sea.
- `moonlit-courtyard` is pinned ahead of time: it is the place Lyra's contract
  leads to, generated in play. Draw its archway now so the pin has somewhere
  to land when it appears.

Shared style (paste in front of every prompt, already included below):

> Hand-painted dark fantasy game map, ruined seaside observatory on a cliff at
> night, wet grey stone overgrown with ivy, tarnished bronze astrolabe rings,
> pale crescent moonlight and a faint lavender geometric glow, drifting sea
> mist, soft painterly brushwork, clean readable shapes, cinematic but legible
> like a premium tabletop RPG map, no text.

---

## world — the old seaside observatory (floor plan)

Output: `assets/maps/seaside-observatory.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| moonlit-courtyard | 0.50 | 0.14 | a collapsed stone archway at the top, opening onto moonlit ruins beyond |
| blue-ribbon | 0.46 | 0.52 | one slender blue ribbon, untied, lying at the centre of the summoning circle |
| lyra | 0.64 | 0.42 | clear stone floor on the right edge of the circle (character drawn by the game — leave floor, no person) |
| player | 0.32 | 0.82 | the top of the stone stair where you came up, lower left |

```text
Hand-painted dark fantasy game map, ruined seaside observatory on a cliff at night, wet grey stone overgrown with ivy, tarnished bronze astrolabe rings, pale crescent moonlight and a faint lavender geometric glow, drifting sea mist, soft painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of the round stone floor of a roofless, ruined observatory on a sea cliff, battle-map view, 16:9, the circular floor centred, broken walls drawn as thick crumbling outlines, dark sea and mist around the cliff edge. In the middle of the floor a large faint lavender summoning circle of rings, star lines and crescent shapes etched into wet stone; at its centre, slightly left, one slender blue ribbon lies loose and untied, clearly visible against the grey stone. Clear floor on the right side of the circle. On the far right, a huge broken bronze astrolabe of tilted rings lying across fallen stones. At the top, a collapsed pointed archway in the wall opening onto moonlit ruined towers and a stone bridge beyond. Lower left, the top of a worn stone stair coming up from below. Candles guttering in wall niches, a torn star banner, ivy and puddles reflecting the crescent moon. No people, no text, no labels, no grid.
```
