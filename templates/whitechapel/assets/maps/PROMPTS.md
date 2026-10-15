# Whitechapel — map prompts

One drawn map per layer, for map mode (docs/ux/24). The scene pictures in
`assets/scenes/` and `assets/backgrounds/` show where you stand; these show the
place **from above**, so the world reads as a world and not as a single picture.

## How to use this file

1. Generate each image below. Save it at the **Output** path, in all three
   editions (`templates/whitechapel`, `templates/whitechapel-zh`,
   `templates/whitechapel-jp` — the maps carry no text, so one picture serves
   all three).
2. That's it. The layer README already names the file under `map.plan.picture`,
   so map mode shows it the moment it exists. Until then it falls back to the
   scene picture.
3. The generator will not hit the spots exactly. After generating, ask Claude to
   look at the image and move the pins in `map.plan.pins` onto what was drawn.

## Rules for every map in this world

- 16:9, 2048×1152 (at least 1600×900). WebP, or PNG to convert later.
- **No text, letters, numbers, labels, legends, compass roses with letters,
  grids, UI, frames or watermarks.** Shop signs, street signs and papers stay
  blank. The game draws its own labels.
- Every place, object and person in the pin table must be **drawn as a clear,
  readable landmark at that spot**. Keep 6% clear margin at the edges.
- Leave the bottom-centre strip calm: the story caption and the player sit there.
- The camera is the same for every layer of a kind (see each prompt): London is
  seen from a high bird's-eye angle; rooms, the alley and the courtyard are a
  straight top-down floor plan, like a tabletop RPG battle map.
- No bodies, no blood. The crime scene is shown only through what was left.

Shared style (paste in front of every prompt, already included below):

> Hand-painted Victorian gothic game map of 1888 London, soot-black brick and
> wet cobblestones, gaslight amber against cold blue-grey fog, dark oak, brass
> and deep crimson in the interiors, detailed painterly brushwork, clean
> readable shapes, cinematic but legible like a premium tabletop RPG map, no
> text.

---

## world — 221B, the sitting room (floor plan)

Output: `assets/maps/baker-street-sitting-room.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| watson-letter | 0.56 | 0.54 | a letter with a red wax seal on a silver tray, on the round tea table |
| fourth-illustration | 0.66 | 0.58 | an engraved illustration print lying beside the tray, same table |
| blue-brass-cap | 0.60 | 0.66 | a small brass paint-tube cap with a smear of ultramarine blue, front edge of the table |
| london-map | 0.80 | 0.16 | the sitting-room door on the top wall, right, open to the stairs down to Baker Street |
| watson | 0.40 | 0.42 | clear floor on the Persian rug in the middle (the character is drawn by the game — leave floor, no person) |
| player | 0.22 | 0.80 | a wing-backed leather armchair by the fire, bottom-left |

```text
Hand-painted Victorian gothic game map of 1888 London, soot-black brick and wet cobblestones, gaslight amber against cold blue-grey fog, dark oak, brass and deep crimson in the interiors, detailed painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of a cluttered Victorian bachelor's sitting room, battle-map view, 16:9. Dark oak floorboards under a large crimson-and-navy Persian rug, walls drawn as thick outlines with patterned dark-green wallpaper edges. On the left wall a carved fireplace with a roaring fire and brass fender; in front of it at the bottom-left, a buttoned brown leather wing-backed armchair with a plaid throw. Bookshelves, a violin on a side table, a chemistry bench with glassware along the top wall. A tall bay window with lace curtains on the right wall, fog outside. Right of centre, a round mahogany tea table with a silver tray; on it a letter sealed with red wax (left part of the table), an engraved illustration print lying flat beside the tray (right part), and at the front edge a small brass paint-tube cap with a vivid smear of ultramarine blue. A teapot and cups. In the upper right of the top wall, the room's door standing open onto a dark stairwell. Open rug space in the middle of the room. No people, no text, no labels, no grid.
```

## world/london-map — London (city map)

Output: `assets/maps/london-map.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| edith-room | 0.14 | 0.26 | a tall terraced townhouse with one lit bay window beside a dark park, upper-left (Baker Street) |
| print-shop | 0.48 | 0.44 | a large brick print works with a long glass skylight roof and a smoking chimney, centre (Fleet Street) |
| unnamed-street | 0.56 | 0.58 | the print works' enclosed back courtyard with one gas lamp, just below-right of it |
| morgue | 0.78 | 0.26 | a low grim brick mortuary with a pale lantern over its door, beside a workhouse, upper-right |
| third-crime-scene | 0.86 | 0.54 | a narrow Whitechapel alley cordoned with rope and a police lantern, right |
| player | 0.24 | 0.70 | a hansom cab rank at a lamplit crossroads, left of centre |

```text
Hand-painted Victorian gothic game map of 1888 London, soot-black brick and wet cobblestones, gaslight amber against cold blue-grey fog, dark oak, brass and deep crimson in the interiors, detailed painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
High bird's-eye city map of Victorian London at grey dawn, seen from about 60 degrees above, 16:9, dense slate roofs, chimney smoke and drifting fog, streets glistening with gaslight. The Thames runs along the whole bottom of the map from left to right, dark and calm, with a stone bridge and moored barges. Upper-left, the genteel West End: a dark green park and a row of tall terraced townhouses, one of them with a single warm lit bay window. Left of centre, a lamplit crossroads with a rank of black hansom cabs and horses. Centre: Fleet Street with a large brick print works, a long glass skylight roof glowing amber and a tall smoking chimney; directly below-right of it, its small enclosed cobbled back courtyard with one gas lamp and an arched gate. Right of centre behind it, the great dome of St Paul's rising out of the fog. Upper-right, the East End: a low grim brick mortuary with a pale lantern over its door next to a big blocky workhouse. Right, deep in the crowded slums of Whitechapel, a narrow alley cordoned off with rope and a single police lantern. Crooked lanes, market stalls, railway viaduct, church spires. No people, no text, no labels, no compass, no grid.
```

## world/london-map/edith-room — 221B, the guest parlour (floor plan)

Output: `assets/maps/edith-room.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| address-correction | 0.36 | 0.40 | a manuscript on a writing desk, one line boldly crossed out and rewritten in ink, pen beside it |
| edith | 0.62 | 0.44 | clear floor by the curtained window seat (the character is drawn by the game — leave floor, no person) |
| player | 0.46 | 0.88 | the parlour door, bottom |

```text
Hand-painted Victorian gothic game map of 1888 London, soot-black brick and wet cobblestones, gaslight amber against cold blue-grey fog, dark oak, brass and deep crimson in the interiors, detailed painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of a small upstairs guest parlour in a Victorian townhouse, battle-map view, 16:9. Polished floorboards with a faded rose-pattern rug, papered walls drawn as thick outlines. Left of centre, a lady's writing desk with an oil lamp; on it a thick handwritten manuscript with one line boldly crossed out and rewritten in dark ink, a dip pen and inkwell beside it (the writing only as illegible scribble). On the right, a tall window with heavy drawn crimson curtains and a cushioned window seat, clear floor in front of it. A small fireplace with a low fire on the top wall, a narrow day bed with a shawl, a teacup on a stand, a hat box, a travelling trunk. The parlour door at the bottom centre, ajar onto a dim landing. No people, no text, no labels, no grid.
```

## world/london-map/morgue — the mortuary (floor plan)

Output: `assets/maps/morgue.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| time-record | 0.66 | 0.40 | an open ledger on a clerk's high desk, a round wall clock above it, right |
| player | 0.30 | 0.86 | the heavy door, bottom-left |

```text
Hand-painted Victorian gothic game map of 1888 London, soot-black brick and wet cobblestones, gaslight amber against cold blue-grey fog, dark oak, brass and deep crimson in the interiors, detailed painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of a small cold Victorian mortuary room, battle-map view, 16:9. Pale worn flagstone floor with a drain in the middle, whitewashed brick walls drawn as thick outlines, a single hanging gas lamp giving a weak green-amber pool of light. Left of centre, an empty stone slab with a folded white sheet laid neatly on it. Right, a clerk's tall slanted desk with an open ledger, a pen and an oil lamp, and a round wall clock hung directly above it. Along the top wall, a row of tall wooden cabinets, a porcelain sink, a bucket and mop, a hook with a rubber apron. A heavy iron-studded door at the bottom-left, ajar to a foggy street. No people, no bodies, no blood, no text, no labels, no grid.
```

## world/london-map/print-shop — the print works (floor plan)

Output: `assets/maps/print-shop.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| editor-office | 0.18 | 0.24 | a glass-partitioned office in the upper-left corner, its door facing the hall |
| illustration-room | 0.80 | 0.24 | a curtained studio corner in the upper-right with an easel under a sheet |
| tom | 0.50 | 0.46 | clear floor between the two iron presses in the centre (the character is drawn by the game — leave floor, no person) |
| receipt | 0.32 | 0.58 | a big receiving ledger open on a slanted clerk's desk with an oil lamp, left |
| shift-ledger | 0.66 | 0.62 | a duty roster on a clipboard hung on an iron pillar by the type-case table, right |
| player | 0.48 | 0.88 | the street doors, bottom centre |

```text
Hand-painted Victorian gothic game map of 1888 London, soot-black brick and wet cobblestones, gaslight amber against cold blue-grey fog, dark oak, brass and deep crimson in the interiors, detailed painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of a large Victorian print works hall at night, battle-map view, 16:9. Dark ink-stained floorboards, brick walls drawn as thick outlines, cast-iron pillars, hanging brass lanterns making pools of amber light. Two big black iron flatbed printing presses with flywheels side by side in the upper middle, with clear floor between and below them. Upper-left corner: a small editor's office walled with glass-and-wood partitions, its door facing the hall. Upper-right corner: an artist's studio closed off by a heavy crimson curtain, an easel draped in a white sheet visible inside. Left, a slanted clerk's desk with a big open ledger and a glowing oil lamp. Right, a compositor's table of type cases and ink rollers next to an iron pillar with a clipboard roster hanging on it. Stacks of paper bundles, drying racks, crates, a spiral stair. The double street doors at the bottom centre. No people, no text, no labels, no grid.
```

## world/london-map/print-shop/editor-office — the editor's office (floor plan)

Output: `assets/maps/editor-office.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| correction-log | 0.48 | 0.44 | an open correction log on the big desk, a manuscript bundle tied with string beside it |
| blackburn | 0.66 | 0.34 | clear floor behind the desk by a leather chair (the character is drawn by the game — leave floor, no person) |
| player | 0.30 | 0.86 | the half-glazed door, bottom-left |

```text
Hand-painted Victorian gothic game map of 1888 London, soot-black brick and wet cobblestones, gaslight amber against cold blue-grey fog, dark oak, brass and deep crimson in the interiors, detailed painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of a cramped Victorian newspaper editor's office, battle-map view, 16:9. Worn floorboards and a threadbare rug, walls of dark wood panelling and glass partitions drawn as thick outlines. In the centre, a big cluttered oak desk under a green-shaded lamp; on it an open correction log and a manuscript bundle tied with string, blue pencils, a spike of papers, a paperweight. Behind the desk on the upper right, a cracked leather swivel chair with clear floor beside it. Pigeonhole shelves stuffed with proofs, a coat stand with a bowler hat, a small iron safe, stacks of newspapers on the floor. A half-glazed door at the bottom-left looking out onto the press hall. No people, no text, no labels, no grid.
```

## world/london-map/print-shop/illustration-room — the illustration room (floor plan)

Output: `assets/maps/illustration-room.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| visible-details | 0.44 | 0.46 | a drawing table with the altered manuscript, jars of ultramarine paint, a blue-stained rag and a roll of fresh bandage |
| wayne | 0.64 | 0.40 | clear floor between the drawing table and the easel (the character is drawn by the game — leave floor, no person) |
| player | 0.28 | 0.86 | the gap in the crimson curtain, bottom-left |

```text
Hand-painted Victorian gothic game map of 1888 London, soot-black brick and wet cobblestones, gaslight amber against cold blue-grey fog, dark oak, brass and deep crimson in the interiors, detailed painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of a small Victorian illustrator's studio, battle-map view, 16:9. Paint-spattered floorboards, walls drawn as thick outlines and hung with pinned engravings and sketches of London streets. Left of centre, a big tilted drawing table under a hanging lamp; on it a handwritten manuscript, several open jars of vivid ultramarine blue paint, brushes, a rag stained blue, and a loosely unrolled strip of fresh white bandage. Upper right, a tall easel draped with a white sheet, with clear floor between it and the table. A stool, a washstand with a cloudy blue basin, stacked canvases and a plan chest. A heavy crimson curtain forms the bottom-left wall, parted at one spot as the way in. No people, no text, no labels, no grid.
```

## world/london-map/third-crime-scene — the third scene (alley plan)

Output: `assets/maps/third-crime-scene.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| pigment-record | 0.30 | 0.40 | an iron railing on the left with a bright smear of blue paint and a dented, scuffed bar |
| player | 0.52 | 0.88 | the mouth of the alley with a police rope across it, bottom centre |

```text
Hand-painted Victorian gothic game map of 1888 London, soot-black brick and wet cobblestones, gaslight amber against cold blue-grey fog, dark oak, brass and deep crimson in the interiors, detailed painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down battle map of a narrow Whitechapel alley at grey dawn, 16:9. Wet black cobblestones run from the bottom centre up through the middle, puddles reflecting a single wall-mounted gas lamp. Along the left, a length of black iron railing in front of a sunken basement area; on the railing a bright smear of ultramarine blue paint and one bar dented and scuffed. Right of centre, in the middle of the cobbles, a single wooden chair set upright and a man's top hat placed on the ground beside it, arranged deliberately, as if staged. Barrels, crates, a handcart and a drain along the right-hand brick wall; fog drifting in from the top. At the bottom centre, the mouth of the alley with a thick police rope strung between two iron posts. No people, no bodies, no blood, no chalk figure, no text, no labels, no grid.
```

## world/london-map/unnamed-street — the print works courtyard (courtyard plan)

Output: `assets/maps/unnamed-street.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| revision-scrap | 0.34 | 0.42 | a torn scrap of proof paper held down by a stone on top of a barrel, left |
| meeting-options | 0.66 | 0.46 | a folded note on an upturned crate under the gas lamp, right |
| player | 0.48 | 0.88 | the arched gate from the street, bottom centre |

```text
Hand-painted Victorian gothic game map of 1888 London, soot-black brick and wet cobblestones, gaslight amber against cold blue-grey fog, dark oak, brass and deep crimson in the interiors, detailed painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down battle map of the small enclosed back courtyard of a Victorian print works at night, 16:9. Wet cobbles and puddles, soot-black brick walls on all sides drawn as thick outlines. Along the top wall, the back door of the print works with a lit transom window and stacks of spoiled paper bales beside it. Left of centre, a wooden barrel with a torn scrap of proof paper held down by a stone on its lid. Right of centre, a tall iron gas lamp throwing a warm circle of light, and inside it an upturned crate with a folded note lying on top. Bare tree in a corner, a water pump, a handcart, a drain, fog creeping over the wall. At the bottom centre, an arched brick gate with iron doors standing open onto the street. Clear cobbles around the lamp for figures to stand. No people, no text, no labels, no grid.
```
