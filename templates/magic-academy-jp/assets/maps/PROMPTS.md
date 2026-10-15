# Magic Academy — map prompts

One drawn map per layer, for map mode (docs/ux/24). The scene picture in
`assets/scenes/` shows where you stand; these show the place **from above**, so
the world reads as a world and not as a single picture.

## How to use this file

1. Generate each image below. Save it at the **Output** path, in all three
   editions (`templates/magic-academy`, `templates/magic-academy-zh`,
   `templates/magic-academy-jp` — the maps carry no text, so one picture serves
   all three).
2. That's it. The layer README already names the file under `map.plan.picture`,
   so map mode shows it the moment it exists. Until then it falls back to the
   scene picture.
3. The generator will not hit the spots exactly. After generating, ask Claude to
   look at the image and move the pins in `map.plan.pins` onto what was drawn.

## Rules for every map in this world

- 16:9, 2048×1152 (at least 1600×900). WebP, or PNG to convert later.
- **No text, letters, numbers, labels, legends, compass roses with letters,
  grids, UI, frames or watermarks.** Book spines and scrolls stay blank; runes
  are simple glowing shapes, never letters. The game draws its own labels.
- Every place, object and person in the pin table must be **drawn as a clear,
  readable landmark at that spot**. Keep 6% clear margin at the edges.
- Leave the bottom-centre strip calm: the story caption and the player sit there.
- Never draw people. Where a character stands, leave clear floor; the game
  draws them.
- Both layers are indoors, so both are a straight top-down floor plan, like a
  tabletop RPG battle map. Keep the look of `academy-library.webp`: gothic
  stone pillars, tall walnut bookcases with ladders, brass armillary spheres,
  midnight-blue banners with gold stars and crescents, a star-compass inlaid in
  the marble floor.

Shared style (paste in front of every prompt, already included below):

> Hand-painted fantasy game map, gothic magic academy at night, dark walnut
> bookcases and pale carved stone, midnight-blue banners with gold stars and
> crescent moons, warm brass lantern and candle light, polished dark marble
> floor inlaid with gold star-compass lines, soft painterly brushwork, clean
> readable shapes, cinematic but legible like a premium tabletop RPG map, no text.

---

## world — the night library (floor plan)

Output: `assets/maps/night-library.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| spell-atlas | 0.80 | 0.30 | a pointed stone archway on the upper right, glowing blue-gold, leading to the materials room |
| freshman-badge | 0.40 | 0.50 | a small brass-rimmed name tag on the big reading table, left of centre |
| seraphina | 0.56 | 0.40 | clear floor between two bookcases just beyond the table (character drawn by the game — leave floor, no person) |
| player | 0.30 | 0.86 | the great double door, bottom-left |

```text
Hand-painted fantasy game map, gothic magic academy at night, dark walnut bookcases and pale carved stone, midnight-blue banners with gold stars and crescent moons, warm brass lantern and candle light, polished dark marble floor inlaid with gold star-compass lines, soft painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of a grand gothic library hall at night, battle-map view, 16:9, walls and pillars drawn as thick stone outlines. Tall walnut bookcases with rolling ladders line the left and top walls; tall lancet windows along the top wall show a rainy night. A long reading table in the centre-left with an open book, a quill, an hourglass and a candle lantern; on the table, left of centre, a small brass-rimmed name tag catching the light. Just beyond the table, slightly right of centre, an open aisle of marble floor between two bookcases. Upper right: a pointed stone archway hung with a star banner, a soft blue-gold glow spilling from the room behind it. Lower right: a big gold star-compass inlaid in the floor, a brass armillary sphere, a wall of small wooden card-catalogue drawers. Bottom-left: a great carved double door. No people, no text, no labels, no grid.
```

## world/spell-atlas — the materials room (floor plan)

Output: `assets/maps/spell-atlas.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| star-fragment | 0.22 | 0.42 | a small warm-glowing star stone on a velvet cushion, on a pedestal at the left |
| small-hand-mirror | 0.40 | 0.28 | a small round silver hand mirror on a stand, upper left of centre |
| opening-fragment | 0.60 | 0.28 | a glowing tile of brass with an open-circle rune, in a tray, upper right of centre |
| reflection-fragment | 0.78 | 0.42 | a glowing tile of brass with a mirrored double-arc rune, in a tray, at the right |
| librarian | 0.72 | 0.64 | clear floor behind the loan desk with its ledger, lower right (character drawn by the game) |
| player | 0.40 | 0.88 | the archway you came in through, bottom |

```text
Hand-painted fantasy game map, gothic magic academy at night, dark walnut bookcases and pale carved stone, midnight-blue banners with gold stars and crescent moons, warm brass lantern and candle light, polished dark marble floor inlaid with gold star-compass lines, soft painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of a small vaulted materials room in a magic academy, battle-map view, 16:9, stone walls as thick outlines, walls lined with glass-fronted cabinets of jars and crystals. A curved arc of four display stands runs across the upper half, each under its own soft pool of light: far left, a stone pedestal with a small warm-glowing star stone on a dark velvet cushion; upper left of centre, a small round silver hand mirror on a little brass stand; upper right of centre, a velvet tray holding a brass tile with a simple glowing open-circle rune; far right, a velvet tray holding a brass tile with a glowing mirrored double-arc rune. In the middle, a gold star-compass inlaid in the floor. Lower right: a wooden loan desk with a large open ledger, a quill and a brass lamp, empty floor behind it. A pointed archway at the bottom centre leading back to the library. No people, no text, no labels, no grid.
```
