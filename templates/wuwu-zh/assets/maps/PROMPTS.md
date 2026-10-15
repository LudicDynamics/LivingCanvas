# Fog Harbor — map prompts

One drawn map per layer, for map mode (docs/ux/24). The scene pictures in
`assets/scenes/` show where you stand; these show the place **from above**, so
the world reads as a world and not as a single picture.

## How to use this file

1. Generate each image below. Save it at the **Output** path, in all three
   editions (`templates/wuwu`, `templates/wuwu-zh`, `templates/wuwu-jp` — the
   maps carry no text, so one picture serves all three).
2. That's it. The layer README already names the file under `map.plan.picture`,
   so map mode shows it the moment it exists. Until then it falls back to the
   scene picture.
3. The generator will not hit the spots exactly. After generating, ask Claude to
   look at the image and move the pins in `map.plan.pins` onto what was drawn.

## Rules for every map in this world

- 16:9, 2048×1152 (at least 1600×900). WebP, or PNG to convert later.
- **No text, letters, numbers, labels, legends, compass roses with letters,
  grids, UI, frames or watermarks.** The game draws its own labels.
- Every place, object and person in the pin table must be **drawn as a clear,
  readable landmark at that spot**. Keep 6% clear margin at the edges.
- Leave the bottom-centre strip calm: the story caption and the player sit there.
- The camera is the same for every layer of a kind (see each prompt): a town is
  seen from a high bird's-eye angle; an interior or a dock is a straight
  top-down floor plan, like a tabletop RPG battle map.

Shared style (paste in front of every prompt, already included below):

> Hand-painted fantasy game map, rain-soaked gothic harbour of the steam age,
> muted violet-grey stone and slate, wet cobbles reflecting warm lamp amber,
> thin sea fog, soft painterly brushwork, clean readable shapes, cinematic but
> legible like a premium tabletop RPG map, no text.

---

## world — the harbour office (floor plan)

Output: `assets/maps/harbor-office.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| harbor-chart | 0.84 | 0.42 | a large harbour chart pinned on the right wall, beside a door out to the quay |
| commission-letter | 0.46 | 0.52 | a sealed letter on the big central desk |
| investigator-badge | 0.56 | 0.53 | a brass badge on a leather wallet, same desk |
| vera | 0.62 | 0.38 | clear standing space at the desk's far side (the character is drawn by the game — leave floor, no person) |
| player | 0.30 | 0.86 | the front door, bottom-left, open to the rain |

```text
Hand-painted fantasy game map, rain-soaked gothic harbour of the steam age, muted violet-grey stone and slate, wet cobbles reflecting warm lamp amber, thin sea fog, soft painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of a small harbour office interior, battle-map view, 16:9. Dark wooden floorboards, stone walls drawn as thick outlines, tall rain-streaked windows along the top wall. A large oak desk in the centre with an oil lamp; on the desk a sealed letter with a red wax seal (slightly left of centre) and a brass badge on a leather wallet (slightly right of centre). On the right wall, a big pinned harbour chart next to a side door leading out to a wet quay. The front door at the bottom-left stands open, rain on the threshold. Filing cabinets, a coat stand, a brass bell, stacked ledgers along the walls. Empty floor space behind the desk on the upper right. No people, no text, no labels, no grid.
```

## world/harbor-chart — the harbour (town map)

Output: `assets/maps/harbor-chart.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| old-lighthouse | 0.18 | 0.22 | a tall dark lighthouse on a rocky cape, upper-left, its lamp unlit |
| seventh-berth | 0.46 | 0.55 | a long wooden pier in the middle with one black three-masted ship moored, no crew |
| workshop | 0.72 | 0.62 | a shipwright's workshop with a glowing window on the quay, right |
| player | 0.16 | 0.86 | the harbour office, a small building bottom-left with a lit doorway |

```text
Hand-painted fantasy game map, rain-soaked gothic harbour of the steam age, muted violet-grey stone and slate, wet cobbles reflecting warm lamp amber, thin sea fog, soft painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
High bird's-eye town map of a small foggy harbour, seen from about 60 degrees above, 16:9. Dark sea fills the upper half and the centre; a curved stone quay with gabled houses runs along the bottom and up the right side. Upper-left: a rocky cape with a tall dark lighthouse, its lamp unlit. Centre: a long wooden pier (berth) reaching into the water with a single black three-masted ship moored alongside, sails furled, deck empty. Right, on the quay: a shipwright's workshop with a big timber door and one warm glowing window. Bottom-left: a small harbour office with a lit doorway and a hanging lantern. Top-right corner: a thick wall of fog swallowing the sea. Cranes, crates, bollards, rain puddles, lamp posts along the quay. No people, no text, no labels, no compass, no grid.
```

## world/harbor-chart/seventh-berth — Berth 7 (dock plan)

Output: `assets/maps/seventh-berth.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| waterline-trace | 0.24 | 0.40 | deep fresh scrape marks high on the ship's hull, left |
| silver-kite | 0.70 | 0.66 | open pier planks right of centre (character drawn by the game) |
| player | 0.50 | 0.90 | the end of the pier where you walk on, bottom centre |

```text
Hand-painted fantasy game map, rain-soaked gothic harbour of the steam age, muted violet-grey stone and slate, wet cobbles reflecting warm lamp amber, thin sea fog, soft painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down battle map of a wooden pier at night, 16:9. A black three-masted ship lies moored along the upper half, its hull running left to right, deck visible from above with coiled ropes and a hatch left open. On the hull's left side, above the waterline, long pale scrape marks gouged into the black paint, clearly visible. The pier fills the lower half: wet planks, iron bollards with mooring lines, one lantern on a post, an empty wooden crate with its lid off near the right. Dark water with fog between the planks and the ship. Open planks on the right for a figure to stand, the pier entrance at bottom centre. No people, no text, no labels, no grid.
```

## world/harbor-chart/workshop — the workshop (floor plan)

Output: `assets/maps/workshop.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| crest-clasp | 0.50 | 0.48 | a broken bronze rudder clasp with a family crest, under the lamp on the workbench |
| player | 0.44 | 0.88 | the big timber door, bottom |

```text
Hand-painted fantasy game map, rain-soaked gothic harbour of the steam age, muted violet-grey stone and slate, wet cobbles reflecting warm lamp amber, thin sea fog, soft painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of a shipwright's workshop, battle-map view, 16:9. A long heavy workbench in the centre under a hanging lamp that throws a warm circle of light; in the middle of the light, a broken bronze rudder clasp engraved with a noble crest. Around the room: a half-built rowing boat on trestles, racks of planks, coils of rope, a forge in one corner with embers, tool walls, sawdust on the floor. A wide timber double door at the bottom, ajar to the rainy quay. No people, no text, no labels, no grid.
```

## world/harbor-chart/old-lighthouse — the old lighthouse (floor plan)

Output: `assets/maps/old-lighthouse.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| lighthouse-logbook | 0.28 | 0.62 | an open logbook on a small writing desk, left |
| lamp-oil | 0.18 | 0.48 | a few brass oil cans against the wall, far left |
| old-mo | 0.64 | 0.44 | floor beside the foot of the spiral stair (character drawn by the game) |
| player | 0.48 | 0.90 | the iron door, bottom |

```text
Hand-painted fantasy game map, rain-soaked gothic harbour of the steam age, muted violet-grey stone and slate, wet cobbles reflecting warm lamp amber, thin sea fog, soft painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of the round ground floor of an old stone lighthouse, battle-map view, 16:9, the circular room centred with dark wet rocks and sea spray around it. Inside: a spiral iron staircase rising at the right of centre; a small writing desk on the left with an open logbook and a candle; brass oil cans lined against the far-left wall; a stove, a narrow cot, hanging oilskins, a clock on the wall. A heavy iron-banded door at the bottom opening onto a rock path. Floor space beside the foot of the stair. No people, no text, no labels, no grid.
```
