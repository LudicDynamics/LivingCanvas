# The Last Train · Image Generation Prompts

All images have been delivered and integrated (scenes, maps, ending images, Xia Cheng / Zhong Huaili / player portraits come first; 2026-09-28 fill in the four NPC portraits for Su He, Zhou Zihang, Old Qin, and Old He, plus 12 item icons, see "Item Icons" at the end). This file lists every image in this world: one scene image per floor, one portrait per character, one top-down map per floor, one ending image per ending. Prompts are in English so they can be fed directly to an image model.

## How to Use

1. Generate according to the prompts below, save to the **Output** path (WebP; generating PNG first and converting is fine too).
2. Maps: the `map.plan.picture` in each floor's README already has the file name written; once the image is placed, map mode will display it. The generator won't draw exactly at the pin positions; after generating, have Claude look at the image and move the `map.plan.pins` to where they were actually drawn.
3. Scene images, portraits, ending images: after placing the files, add the keys according to the last section "frontmatter to add once images arrive". **Do not add these keys while the images don't exist yet** - the world check requires media paths to actually exist.

## Unified Art Style

Scene images and ending images (prepend to each scene prompt, already included below):

> Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.

Maps (prepend to each map prompt, already included below):

> Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.

Map rules: 16:9, 2048×1152 (at least 1600×900). Every entry in the pin table must be drawn as a clearly recognizable landmark at the corresponding position, leave 6% blank margin on all four sides, and leave a calm strip at the bottom center (for subtitles and where the player stands). **Do not draw people on the map** - characters are drawn by the game itself, leave an empty space at the pin. Car top-down views are always a long rectangular car spanning the image, with the aisle along the lower part of the image and the entrance door at the bottom center.

---

## 1. Scene Images (one per floor)

### world - Broken Cloud Tunnel · The Stopped Last Train

Output: `assets/scenes/tunnel-train.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
A five-car night train stands motionless inside a long curved concrete railway tunnel, seen from the narrow maintenance walkway at a low three-quarter angle. Old green passenger cars with dim amber emergency lights in the windows, a sleeper car with drawn curtains, a dining car with a warm glow, and at the far rear a dark windowless baggage car with a padlocked sliding door. Far ahead beyond the locomotive, a pile of fallen rock and a single red warning lamp. Wet rails, dripping water, a railway wall clock on the tunnel wall near the front. No people, no text.
```

### world/cab - Car 1 · Cab

Output: `assets/scenes/cab.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an old diesel locomotive cab at night. A worn control desk with dark gauges, only a small green light glowing on a radio set with a hanging handset. A notice paper clipped to the dashboard. On the right wall a wooden key board with rows of keys on red tags, one hook conspicuously empty. The windscreen shows the dark tunnel and a distant red warning lamp over fallen rocks. A lantern and muddy boots by the seat. No people, no readable text.
```

### world/seated-car - Car 2 · Hard Seat Car

Output: `assets/scenes/seated-car.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an old hard-seat passenger car at night under dim amber emergency lights, rows of facing blue vinyl benches, passengers' coats and bags, the windows black with tunnel wall. In the foreground one empty window seat holds a canvas tote bag, a steel thermos and an open notebook with a yellowed newspaper clipping tucked inside. Further down, a student's backpack and earphones on a seat. The aisle leads toward the rear door. No faces in focus, no readable text.
```

### world/sleeper - Car 3 · Sleeper Car

Output: `assets/scenes/sleeper.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
The narrow side corridor of an old soft-sleeper car at night, wood-panelled compartment doors mostly closed. One compartment door stands ajar; on a hook beside it hangs a grey wool overcoat, a few strands of yellow jute fibre caught on its hem. Through the gap: a lower berth with a white pillow and a half-open leather suitcase. Amber corridor lamps, dark windows. No people, no readable text.
```

### world/dining-car - Car 4 · Dining Car

Output: `assets/scenes/dining-car.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an old railway dining car at night, white tablecloths, small table lamps. On one table two uncleared teacups, one with a pale residue at the bottom, and a small paper receipt pinned under a saucer. At the far end a steaming hot-water boiler and an iron coal scuttle beside it, coal dust scattered on the floor. A cook's white cap on the counter. A door at the end leads to the dark rear car. No people, no readable text.
```

### world/freight-car - Car 5 · Baggage Car

Output: `assets/scenes/freight-car.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an unheated railway baggage car, breath-fogging cold, frost on the steel walls. A mountain of yellow jute mail sacks; in a hollow among them a woman's dark coat and a red scarf, as if someone has been curled up there. In the corner a small iron stove with a dying orange fire, its door open. The sliding door at the end stands open, a lamp's glow spilling in from the car beyond. No people, no readable text.
```

---

## 2. Character Portraits (one per character)

Unified: anime-painterly character portrait, waist-up, 3:4 or 1:1, plain softly-lit dark backdrop (transparent background preferred), no text.

### Xia Cheng (xia-cheng, companion)

Output: `assets/characters/xia-cheng.webp`

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 24-year-old Chinese female train attendant in a navy railway uniform with a small cap and a brass name badge, short black bob, a passenger clipboard held to her chest, a flashlight clipped to her belt. Quick, earnest eyes, slightly anxious but determined expression. Warm amber emergency light from one side, cold blue shadow on the other. Plain dark background, no text.
```

### Zhong Huaili (zhong-huaili)

Output: `assets/characters/zhong-huaili.webp`

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 62-year-old Chinese man, retired-official bearing, neat grey hair, rimless glasses, a long grey wool overcoat with his right hand resting on the inner breast pocket. Polite, composed half-smile that does not reach his eyes. Dim amber lamp light from below, deep shadows. Plain dark background, no text.
```

### Su He (su-he, the missing passenger in the Car 5 Baggage Car)

Output: `assets/characters/su-he.webp`

Delivered (transparent background). She is the NPC object `world/freight-car/su-he.md` (`type: npc`, `avatar` already integrated), not a registered character; she only knows about things in `su-he-testimony.md`, and the Logbook Page can only be handed over by the `04-confront-dice.md` check.

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 26-year-old Chinese woman who has just been found half-frozen among mail sacks in an unheated baggage car: shoulder-length black hair loose and messy, pale face, faintly purple lips, a long dark women's wool coat pulled tight around her with one hand clutching the empty inner breast pocket, a red knitted scarf half-slipped off one shoulder, frost on the coat's shoulders. Dazed, frightened but alert eyes looking straight at the viewer, as if about to speak. Cold blue light from one side, a warm amber lamp glow from below on the other. Plain dark background, no text.
```

### Zhou Zihang (zhou-zihang, student in Car 2 seat 20, NPC)

Output: `assets/characters/zhou-zihang.webp`

NPC object (`type: npc`), not a registered character; only knows about things in `witness-account.md`.

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 20-year-old Chinese male university student sitting in a hard-seat train carriage at night: messy short black hair, thin-framed glasses, a grey hoodie under an open padded jacket, wired earphones hanging around his neck, a phone glowing faintly in one hand. Tired but wide-awake, uneasy eyes glancing sideways as if he has seen something he does not want to talk about. Cold blue light from the window side, warm amber emergency lamp from above. Plain dark background, no text.
```

### Old Qin (lao-qin, Driver in the Car 1 Cab, NPC)

Output: `assets/characters/lao-qin.webp`

NPC object, not a registered character; only knows that he got off with a lantern at 12:42 AM and came back at 1:05 AM, and that before he got off the Car 5 keys were still hanging on the board.

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 55-year-old Chinese locomotive driver: weathered square face, short grey stubble, a dark-blue railway work uniform with a faded shoulder patch, a padded work jacket, pale limestone dust on his shoulders and sleeves, holding an old railway hand lantern. Gruff, steady, worried eyes. Lit by the small green glow of a radio dial from below and a warm lamp from one side, cold blue shadow on the other. Plain dark background, no text.
```

### Old He (lao-he, Cook in the Car 4 Dining Car, NPC)

Output: `assets/characters/lao-he.webp`

NPC object, not a registered character; dozing at the dining car counter, only knows about things that happened in the dining car.

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 50-year-old Chinese train cook, heavy-set and round-faced, a white cook's jacket with rolled sleeves and a stained apron, a small white cap pushed back, a towel over one shoulder, just woken up with sleepy, slightly suspicious eyes and one hand on a metal counter. Warm steam and amber light from a hot-water boiler at his side, cool blue shadow behind. Plain dark background, no text.
```

### Player (optional)

Output: `assets/characters/player.webp`

```text
Anime-painterly character portrait, waist-up, soft cel shading, seen slightly from behind over the shoulder. A young passenger in a plain dark parka with a scarf, face mostly turned away, holding a phone flashlight toward a dark train corridor. Plain dark background, no text.
```

---

## 3. Top-Down Maps (one per floor)

### world - the whole train stopped in the tunnel

Output: `assets/maps/tunnel-train.webp`

| pin | x | y | What must be drawn |
|---|---|---|---|
| cab | 0.12 | 0.45 | The locomotive at the very front of the train, nose facing left, a pile of fallen rocks and a red light far ahead |
| seated-car | 0.31 | 0.45 | Second car: Hard Seat Car, a row of dim yellow lights in the windows |
| sleeper | 0.50 | 0.45 | Third car: Sleeper Car, curtains drawn |
| dining-car | 0.69 | 0.45 | Fourth car: Dining Car, warmest light in the windows |
| freight-car | 0.88 | 0.45 | Last car: Baggage Car with no windows, side door padlocked |
| departure-clock | 0.14 | 0.74 | A railway wall clock on the tunnel wall (no numbers drawn) |
| passenger-list | 0.34 | 0.72 | A clipboard with paper on the maintenance walkway |
| xia-cheng | 0.44 | 0.66 | An empty spot on the walkway (character drawn by the game) |
| player | 0.50 | 0.88 | Bottom center of the walkway, a calm stretch |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Top-down view of a long straight railway tunnel running left to right across the frame, a five-car train standing on the rails in the middle band. From left to right: a diesel locomotive (nose pointing left, a pile of fallen rocks and a red warning lamp further left), a hard-seat passenger car with amber-lit windows, a sleeper car with curtained windows, a dining car glowing warmest, and a windowless dark baggage car with a padlocked side door at the far right. Below the train, a narrow concrete maintenance walkway with puddles; on the walkway near the front a clipboard with papers, and on the tunnel wall near the locomotive a round railway wall clock without numerals. Open walkway space in the centre-left and a calm stretch at the bottom centre. No people, no text.
```

### world/cab - Car 1 · Cab

Output: `assets/maps/cab.webp`

| pin | x | y | What must be drawn |
|---|---|---|---|
| repair-notice | 0.30 | 0.34 | A notice clipped to the left side of the control desk |
| 02-radio-report | 0.55 | 0.30 | The Radio at the center of the control desk, small green light on, microphone hanging |
| key-board | 0.80 | 0.30 | Key Board on the right wall, a row of red-tag keys, one hook empty |
| player | 0.50 | 0.86 | Bottom center, the door leading to Car 2 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an old diesel locomotive cab, 16:9. Along the top edge a wide control desk under the windscreen: on its left a clipped paper notice, in its centre a radio set with a glowing green light and a coiled handset. On the right wall a wooden key board with a row of keys on red tags, one hook clearly empty. A driver's seat, a lantern and muddy boots on the floor. A door at the bottom centre leading back into the train. No people, no text.
```

### world/seated-car - Car 2 · Hard Seat Car

Output: `assets/maps/seated-car.webp`

| pin | x | y | What must be drawn |
|---|---|---|---|
| su-he-notebook | 0.42 | 0.40 | An empty window seat: canvas bag, thermos, open notebook |
| witness-account | 0.66 | 0.40 | A student's schoolbag and headphones on another seat |
| player | 0.50 | 0.86 | Bottom center aisle |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of a long hard-seat passenger car running left to right, 16:9. Pairs of facing blue benches along the upper half by the windows, luggage racks above, coats and bags on some seats. Left of centre, one empty window seat holding a canvas tote bag, a steel thermos and an open notebook. Right of centre, a student's backpack and earphones on a seat. The aisle runs along the lower part; entrance at the bottom centre, doors at both ends. No people, no text.
```

### world/sleeper - Car 3 · Sleeper Car

Output: `assets/maps/sleeper.webp`

| pin | x | y | What must be drawn |
|---|---|---|---|
| grey-coat | 0.35 | 0.34 | A Grey Wool Coat hanging by a half-open compartment door |
| pill-strip | 0.62 | 0.30 | The white pillow on the lower berth of that compartment |
| zhong-huaili | 0.62 | 0.52 | A patch of floor beside the lower berth in the compartment (character drawn by the game) |
| player | 0.50 | 0.86 | Bottom center side corridor |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an old soft-sleeper car running left to right, 16:9. A row of wood-panelled four-berth compartments across the upper two thirds, doors mostly closed; one compartment slightly right of centre with its door ajar, a grey wool overcoat hanging on a hook by the door on the left side, inside a lower berth with a white pillow and a half-open leather suitcase, open floor beside the berth. A narrow side corridor along the bottom with amber lamps; entrance at the bottom centre. No people, no text.
```

### world/dining-car - Car 4 · Dining Car

Output: `assets/maps/dining-car.webp`

| pin | x | y | What must be drawn |
|---|---|---|---|
| tea-bill | 0.38 | 0.42 | A Receipt pressed under a saucer on a table |
| two-teacups | 0.44 | 0.36 | Two uncollected Teacups on the same table |
| freight-key | 0.84 | 0.34 | An iron Coal Scuttle by the water boiler at the end of the car, coal ash stirred up |
| player | 0.50 | 0.86 | Bottom center aisle |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an old railway dining car running left to right, 16:9. Tables with white cloths and small lamps along the windows; on one table left of centre two uncleared teacups and a small paper receipt under a saucer. A service counter on the left end with a cook's cap on it. At the right end a steaming hot-water boiler with an iron coal scuttle beside it, coal dust scattered and disturbed. The aisle along the bottom, entrance at the bottom centre, a door at the right end to the rear car. No people, no text.
```

### world/freight-car - Car 5 · Baggage Car

Output: `assets/maps/freight-car.webp`

| pin | x | y | Must be drawn |
|---|---|---|---|
| su-he-testimony | 0.36 | 0.44 | A hollow in the pile of mail sacks, a dark women's coat and a red scarf |
| 04-confront-dice | 0.72 | 0.30 | The tin stove in the corner, its door open, the fire nearly out |
| player | 0.50 | 0.86 | The door at the bottom center |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an unheated railway baggage car running left to right, 16:9, frost on the steel walls. Piles of yellow jute mail sacks fill much of the floor; left of centre a hollow in the sacks with a woman's dark coat and a red scarf left in it. In the upper right corner a small iron stove with its door open and a dying orange fire. Parcels and crates along the walls. A sliding door at the bottom centre standing open, warm lamp light spilling in. No people, no text.
```

---

## IV. Ending images (one per ending)

### found — Found Her

Output: `assets/scenes/ending-found.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, no text, no watermark.
Dawn. The night train emerges from the mouth of a mountain tunnel into pale gold morning light over misty autumn ridges. Seen from beside the track, the last passenger cars catch the first sunlight; in one window, the silhouette of a young woman wrapped in a navy railway coat, another figure beside her. Hopeful, quiet, the darkness behind them. No readable text.
```

### departed — The Train Departed

Output: `assets/scenes/ending-departed.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, no text, no watermark.
Blue pre-dawn at a small mountain station platform. The night train has already pulled in; a black official car waits by the platform with its headlights on, a grey-coated figure walking toward it from behind, carrying a suitcase. At the far end of the train, the rear baggage car door open, a stretcher and two station workers in the cold mist. A single ember-edged scrap of paper drifts on the rails. Muted, melancholic. No readable text.
```

---

## Frontmatter to add once the images arrive

Only add after the corresponding file actually exists (a missing image will fail the world check):

| File | key | Value |
|---|---|---|
| `world.json` | `cover` | `assets/scenes/tunnel-train.webp` |
| `world.json` → `characters[id=xia-cheng]` | `avatar` | `assets/characters/xia-cheng.webp` |
| `world.json` → `characters[id=zhong-huaili]` | `avatar` | `assets/characters/zhong-huaili.webp` |
| `world.json` → `player` | `avatar` | `assets/characters/player.webp` (optional) |
| `characters/xia-cheng/README.md` | `avatar` | `assets/characters/xia-cheng.webp` |
| `characters/zhong-huaili/README.md` | `avatar` | `assets/characters/zhong-huaili.webp` |
| NPC cards for Su He / Zhou Zihang / Old Qin / Old He (`type: npc`) | `avatar` | `assets/characters/su-he.webp` / `zhou-zihang.webp` / `lao-qin.webp` / `lao-he.webp` (connected) |
| `world/README.md` | `bg` | `assets/scenes/tunnel-train.webp` |
| `world/cab/README.md` | `bg` | `assets/scenes/cab.webp` |
| `world/seated-car/README.md` | `bg` | `assets/scenes/seated-car.webp` |
| `world/sleeper/README.md` | `bg` | `assets/scenes/sleeper.webp` |
| `world/dining-car/README.md` | `bg` | `assets/scenes/dining-car.webp` |
| `world/freight-car/README.md` | `bg` | `assets/scenes/freight-car.webp` |
| `endings/found/README.md` | `bg` | `assets/scenes/ending-found.webp` |
| `endings/departed/README.md` | `bg` | `assets/scenes/ending-departed.webp` |

`map.plan.picture` is already written in the six layer READMEs (`assets/maps/<layer>.webp`), no need to add it again; after generation you only need to point `map.plan.pins` at the drawn position.

## Item icons (2026-09-28 delivery)

Square WebP with transparent background, placed in `assets/items/`, displayed by the item card frontmatter's `image:` (the `ItemArtwork` in backpack / item details).

| Image | Where it connects |
|---|---|
| `passenger-list.webp` | `world/passenger-list.md`'s `image` (connected) |
| `departure-clock.webp` | `world/departure-clock.md`'s `image` (connected) |
| `repair-notice.webp` | `world/cab/repair-notice.md`'s `image` (connected) |
| `tea-bill.webp` | `world/dining-car/tea-bill.md`'s `image` (connected) |
| `two-teacups.webp` | `world/dining-car/two-teacups.md`'s `image` (connected) |
| `su-he-notebook.webp` | `world/seated-car/su-he-notebook.md`'s `image` (connected) |
| `grey-coat.webp` | `world/sleeper/grey-coat.md`'s `image` (connected) |
| `key-board.webp` / `freight-key.webp` / `pill-strip.webp` / `logbook-page.webp` / `torn-corner.webp` | Not connected: these five cards are generated at runtime by dice `dice_outcomes[].rewards`, and the reward entries currently only carry `path` / `title` / `body` (`apps/server/src/engine/declared-actions.ts`), so they cannot carry `image`. Once the engine supports it, add `image: assets/items/<id>.webp` to each reward |
