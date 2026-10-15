# The Unwritten Door — map prompts

One drawn map per layer, for map mode (docs/ux/24). The picture in
`assets/backgrounds/` shows where you stand; this shows the place **from
above**, so the world reads as a world and not as a single picture.

This world has one authored layer, the cabin. What lies outside
(`world/outside`) is generated during play and gets no planned map here.

## How to use this file

1. Generate the image below. Save it at the **Output** path, in all three
   editions (`templates/unwritten-door`, `templates/unwritten-door-zh`,
   `templates/unwritten-door-jp` — the map carries no text, so one picture
   serves all three).
2. That's it. The layer README already names the file under `map.plan.picture`,
   so map mode shows it the moment it exists. Until then it falls back to the
   background picture.
3. The generator will not hit the spots exactly. After generating, ask Claude to
   look at the image and move the pins in `map.plan.pins` onto what was drawn.

## Rules for every map in this world

- 16:9, 2048×1152 (at least 1600×900). WebP, or PNG to convert later.
- **No text, letters, numbers, labels, legends, compass roses with letters,
  grids, UI, frames or watermarks.** The envelope is blank; the phone screen is
  dark. The game draws its own labels.
- Every place, object and person in the pin table must be **drawn as a clear,
  readable landmark at that spot**. Keep 6% clear margin at the edges.
- Leave the bottom-centre strip calm: the story caption and the player sit there.
- Never draw people. Where a character stands, leave clear floor; the game
  draws them.
- The cabin is a straight top-down floor plan, like a tabletop RPG battle map.
  Keep the look of `intro.png`: dark weathered plank walls and floor, one
  small shaded table lamp, a rough wooden table with two chairs, a plain plank
  door. Nothing outside the walls is decided yet — show only darkness and rain
  beyond them.

Shared style (paste in front of every prompt, already included below):

> Hand-painted moody game map, a lone wooden cabin on a rainy night, dark
> weathered plank walls and floor, one warm amber table-lamp glow against deep
> brown-black shadow, rain streaking beyond the walls, quiet and uncanny, soft
> painterly brushwork, clean readable shapes, cinematic but legible like a
> premium tabletop RPG map, no text.

---

## world — the cabin (floor plan)

Output: `assets/maps/cabin.webp`

| pin | x | y | what must be there |
|---|---|---|---|
| outside | 0.50 | 0.14 | the plain plank front door in the top wall, unlocked and ajar, darkness and rain beyond |
| letter | 0.40 | 0.52 | a sealed blank envelope on the wooden table, left |
| phone | 0.56 | 0.54 | a smartphone with a dark screen on the same table, right |
| iris | 0.78 | 0.36 | clear floor beside a second, narrower door in the right wall (character drawn by the game — leave floor, no person) |
| player | 0.46 | 0.72 | the chair pulled up to the near side of the table, where you woke |

```text
Hand-painted moody game map, a lone wooden cabin on a rainy night, dark weathered plank walls and floor, one warm amber table-lamp glow against deep brown-black shadow, rain streaking beyond the walls, quiet and uncanny, soft painterly brushwork, clean readable shapes, cinematic but legible like a premium tabletop RPG map, no text.
Strict top-down floor plan of a single-room wooden cabin at night, battle-map view, 16:9, plank walls drawn as thick dark outlines, rain and pure darkness outside them on every side. A rough wooden table in the centre with two chairs, one pulled up on the near (lower) side; on the table, left of centre, a sealed blank paper envelope, and right of centre a smartphone lying face up with a black screen. In the top wall, centred, a plain plank door standing slightly ajar with a thin line of rain-dark night beyond it. In the right wall, upper right, a second narrower door, closed, with a wet patch of floor and clear space just inside it. Upper-left corner: a small side table with a shaded lamp, the only light, casting a warm circle across the floor. A cold stove, a narrow bed and a coat hook along the walls, knots and scuffs in the floorboards. No people, no text, no labels, no grid.
```
