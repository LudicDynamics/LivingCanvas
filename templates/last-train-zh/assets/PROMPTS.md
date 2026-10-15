# 末班车 · 生图 prompt

图已全部交付并接入（场景、地图、结局图、夏澄/钟怀礼/玩家立绘在先；2026-09-28 补齐苏禾、周子航、老秦、老贺四张 NPC 立绘和 12 个物品图标，见文末「物品图标」）。本文件列出这个世界的全部图片：每层一张场景图、每个角色一张立绘、每层一张俯视地图、每个结局一张结局图。prompt 用英文，便于直接喂给生图模型。

## 怎么用

1. 按下面的 prompt 生成，存到 **Output** 路径（WebP；先出 PNG 再转也行）。
2. 地图：每层 README 的 `map.plan.picture` 已经写好文件名，图一放进去地图模式就会显示。生成器不会正好画在钉子的位置，生成后让 Claude 看图，把 `map.plan.pins` 挪到实际画出来的地方。
3. 场景图、立绘、结局图：放好文件后，按最后一节「图到了以后要加的 frontmatter」把 key 补上。**图还不存在时不要加这些 key**——世界检查要求 media 路径真实存在。

## 统一画风

场景图与结局图（贴在每个场景 prompt 前面，下面已经带上）：

> Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.

地图（贴在每张地图 prompt 前面，下面已经带上）：

> Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.

地图规则：16:9，2048×1152（至少 1600×900）。钉子表里每一项都要在对应位置画成清楚可辨的地标，四边留 6% 空白，底部正中留平静的一条（字幕和玩家站在那里）。**地图上不画人**——角色由游戏自己画，钉子处留一块空地。车厢俯视图一律是长条形车厢横贯画面，过道沿画面下部，入口门在底部正中。

---

## 一、场景图（每层一张）

### world — 断云隧道 · 停下的末班车

Output: `assets/scenes/tunnel-train.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
A five-car night train stands motionless inside a long curved concrete railway tunnel, seen from the narrow maintenance walkway at a low three-quarter angle. Old green passenger cars with dim amber emergency lights in the windows, a sleeper car with drawn curtains, a dining car with a warm glow, and at the far rear a dark windowless baggage car with a padlocked sliding door. Far ahead beyond the locomotive, a pile of fallen rock and a single red warning lamp. Wet rails, dripping water, a railway wall clock on the tunnel wall near the front. No people, no text.
```

### world/cab — 1车 · 驾驶室

Output: `assets/scenes/cab.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an old diesel locomotive cab at night. A worn control desk with dark gauges, only a small green light glowing on a radio set with a hanging handset. A notice paper clipped to the dashboard. On the right wall a wooden key board with rows of keys on red tags, one hook conspicuously empty. The windscreen shows the dark tunnel and a distant red warning lamp over fallen rocks. A lantern and muddy boots by the seat. No people, no readable text.
```

### world/seated-car — 2车 · 硬座车

Output: `assets/scenes/seated-car.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an old hard-seat passenger car at night under dim amber emergency lights, rows of facing blue vinyl benches, passengers' coats and bags, the windows black with tunnel wall. In the foreground one empty window seat holds a canvas tote bag, a steel thermos and an open notebook with a yellowed newspaper clipping tucked inside. Further down, a student's backpack and earphones on a seat. The aisle leads toward the rear door. No faces in focus, no readable text.
```

### world/sleeper — 3车 · 卧铺车

Output: `assets/scenes/sleeper.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
The narrow side corridor of an old soft-sleeper car at night, wood-panelled compartment doors mostly closed. One compartment door stands ajar; on a hook beside it hangs a grey wool overcoat, a few strands of yellow jute fibre caught on its hem. Through the gap: a lower berth with a white pillow and a half-open leather suitcase. Amber corridor lamps, dark windows. No people, no readable text.
```

### world/dining-car — 4车 · 餐车

Output: `assets/scenes/dining-car.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an old railway dining car at night, white tablecloths, small table lamps. On one table two uncleared teacups, one with a pale residue at the bottom, and a small paper receipt pinned under a saucer. At the far end a steaming hot-water boiler and an iron coal scuttle beside it, coal dust scattered on the floor. A cook's white cap on the counter. A door at the end leads to the dark rear car. No people, no readable text.
```

### world/freight-car — 5车 · 行李车

Output: `assets/scenes/freight-car.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an unheated railway baggage car, breath-fogging cold, frost on the steel walls. A mountain of yellow jute mail sacks; in a hollow among them a woman's dark coat and a red scarf, as if someone has been curled up there. In the corner a small iron stove with a dying orange fire, its door open. The sliding door at the end stands open, a lamp's glow spilling in from the car beyond. No people, no readable text.
```

---

## 二、角色立绘（每个角色一张）

统一：anime-painterly character portrait, waist-up, 3:4 或 1:1, plain softly-lit dark backdrop (透明底更好), no text.

### 夏澄（xia-cheng，同行者）

Output: `assets/characters/xia-cheng.webp`

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 24-year-old Chinese female train attendant in a navy railway uniform with a small cap and a brass name badge, short black bob, a passenger clipboard held to her chest, a flashlight clipped to her belt. Quick, earnest eyes, slightly anxious but determined expression. Warm amber emergency light from one side, cold blue shadow on the other. Plain dark background, no text.
```

### 钟怀礼（zhong-huaili）

Output: `assets/characters/zhong-huaili.webp`

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 62-year-old Chinese man, retired-official bearing, neat grey hair, rimless glasses, a long grey wool overcoat with his right hand resting on the inner breast pocket. Polite, composed half-smile that does not reach his eyes. Dim amber lamp light from below, deep shadows. Plain dark background, no text.
```

### 苏禾（su-he，5车行李车里的失踪乘客）

Output: `assets/characters/su-he.webp`

已交付（透明底）。她是 NPC 物件 `world/freight-car/su-he.md`（`type: npc`，`avatar` 已接），不是登记角色；只知道 `su-he-testimony.md` 里的事，日志页只能由 `04-confront-dice.md` 的判定交出。

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 26-year-old Chinese woman who has just been found half-frozen among mail sacks in an unheated baggage car: shoulder-length black hair loose and messy, pale face, faintly purple lips, a long dark women's wool coat pulled tight around her with one hand clutching the empty inner breast pocket, a red knitted scarf half-slipped off one shoulder, frost on the coat's shoulders. Dazed, frightened but alert eyes looking straight at the viewer, as if about to speak. Cold blue light from one side, a warm amber lamp glow from below on the other. Plain dark background, no text.
```

### 周子航（zhou-zihang，2车20号的学生，NPC）

Output: `assets/characters/zhou-zihang.webp`

NPC 物件（`type: npc`），不是登记角色；只知道 `witness-account.md` 里的事。

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 20-year-old Chinese male university student sitting in a hard-seat train carriage at night: messy short black hair, thin-framed glasses, a grey hoodie under an open padded jacket, wired earphones hanging around his neck, a phone glowing faintly in one hand. Tired but wide-awake, uneasy eyes glancing sideways as if he has seen something he does not want to talk about. Cold blue light from the window side, warm amber emergency lamp from above. Plain dark background, no text.
```

### 老秦（lao-qin，1车驾驶室的司机，NPC）

Output: `assets/characters/lao-qin.webp`

NPC 物件，不是登记角色；只知道自己零点四十二分提灯下车、一点零五分回来，下车前 5 车钥匙还挂在板上。

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 55-year-old Chinese locomotive driver: weathered square face, short grey stubble, a dark-blue railway work uniform with a faded shoulder patch, a padded work jacket, pale limestone dust on his shoulders and sleeves, holding an old railway hand lantern. Gruff, steady, worried eyes. Lit by the small green glow of a radio dial from below and a warm lamp from one side, cold blue shadow on the other. Plain dark background, no text.
```

### 老贺（lao-he，4车餐车的厨师，NPC）

Output: `assets/characters/lao-he.webp`

NPC 物件，不是登记角色；在餐车柜台打瞌睡，只知道餐车里发生过的事。

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 50-year-old Chinese train cook, heavy-set and round-faced, a white cook's jacket with rolled sleeves and a stained apron, a small white cap pushed back, a towel over one shoulder, just woken up with sleepy, slightly suspicious eyes and one hand on a metal counter. Warm steam and amber light from a hot-water boiler at his side, cool blue shadow behind. Plain dark background, no text.
```

### 玩家（可选）

Output: `assets/characters/player.webp`

```text
Anime-painterly character portrait, waist-up, soft cel shading, seen slightly from behind over the shoulder. A young passenger in a plain dark parka with a scarf, face mostly turned away, holding a phone flashlight toward a dark train corridor. Plain dark background, no text.
```

---

## 三、俯视地图（每层一张）

### world — 停在隧道里的整列车

Output: `assets/maps/tunnel-train.webp`

| pin | x | y | 必须画出来的东西 |
|---|---|---|---|
| cab | 0.12 | 0.45 | 列车最前端的机车，车头朝左，前方远处一堆落石和一盏红灯 |
| seated-car | 0.31 | 0.45 | 第二节：硬座车，车窗一排昏黄的灯 |
| sleeper | 0.50 | 0.45 | 第三节：卧铺车，窗帘拉着 |
| dining-car | 0.69 | 0.45 | 第四节：餐车，窗里暖光最亮 |
| freight-car | 0.88 | 0.45 | 最后一节：没有窗的行李车，侧门挂着锁 |
| departure-clock | 0.14 | 0.74 | 隧道墙上一只铁路挂钟（不画数字） |
| passenger-list | 0.34 | 0.72 | 检修步道上一块夹着纸的写字板 |
| xia-cheng | 0.44 | 0.66 | 步道上的一块空地（角色由游戏画） |
| player | 0.50 | 0.88 | 步道底部正中，平静的一段 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Top-down view of a long straight railway tunnel running left to right across the frame, a five-car train standing on the rails in the middle band. From left to right: a diesel locomotive (nose pointing left, a pile of fallen rocks and a red warning lamp further left), a hard-seat passenger car with amber-lit windows, a sleeper car with curtained windows, a dining car glowing warmest, and a windowless dark baggage car with a padlocked side door at the far right. Below the train, a narrow concrete maintenance walkway with puddles; on the walkway near the front a clipboard with papers, and on the tunnel wall near the locomotive a round railway wall clock without numerals. Open walkway space in the centre-left and a calm stretch at the bottom centre. No people, no text.
```

### world/cab — 1车 · 驾驶室

Output: `assets/maps/cab.webp`

| pin | x | y | 必须画出来的东西 |
|---|---|---|---|
| repair-notice | 0.30 | 0.34 | 操作台左边夹着一张通知 |
| 02-radio-report | 0.55 | 0.30 | 操作台正中的电台，小绿灯亮着，话筒挂着 |
| key-board | 0.80 | 0.30 | 右边墙上的钥匙板，一排红牌钥匙，有一个钩子空着 |
| player | 0.50 | 0.86 | 底部正中通往2车的门 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an old diesel locomotive cab, 16:9. Along the top edge a wide control desk under the windscreen: on its left a clipped paper notice, in its centre a radio set with a glowing green light and a coiled handset. On the right wall a wooden key board with a row of keys on red tags, one hook clearly empty. A driver's seat, a lantern and muddy boots on the floor. A door at the bottom centre leading back into the train. No people, no text.
```

### world/seated-car — 2车 · 硬座车

Output: `assets/maps/seated-car.webp`

| pin | x | y | 必须画出来的东西 |
|---|---|---|---|
| su-he-notebook | 0.42 | 0.40 | 空着的靠窗座位：帆布包、保温杯、摊开的笔记本 |
| witness-account | 0.66 | 0.40 | 另一个座位上的学生书包和耳机 |
| player | 0.50 | 0.86 | 底部正中的过道 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of a long hard-seat passenger car running left to right, 16:9. Pairs of facing blue benches along the upper half by the windows, luggage racks above, coats and bags on some seats. Left of centre, one empty window seat holding a canvas tote bag, a steel thermos and an open notebook. Right of centre, a student's backpack and earphones on a seat. The aisle runs along the lower part; entrance at the bottom centre, doors at both ends. No people, no text.
```

### world/sleeper — 3车 · 卧铺车

Output: `assets/maps/sleeper.webp`

| pin | x | y | 必须画出来的东西 |
|---|---|---|---|
| grey-coat | 0.35 | 0.34 | 一扇虚掩的包厢门边挂着的灰呢大衣 |
| pill-strip | 0.62 | 0.30 | 那间包厢下铺的白枕头 |
| zhong-huaili | 0.62 | 0.52 | 包厢里下铺旁的一块地板（角色由游戏画） |
| player | 0.50 | 0.86 | 底部正中的侧走廊 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an old soft-sleeper car running left to right, 16:9. A row of wood-panelled four-berth compartments across the upper two thirds, doors mostly closed; one compartment slightly right of centre with its door ajar, a grey wool overcoat hanging on a hook by the door on the left side, inside a lower berth with a white pillow and a half-open leather suitcase, open floor beside the berth. A narrow side corridor along the bottom with amber lamps; entrance at the bottom centre. No people, no text.
```

### world/dining-car — 4车 · 餐车

Output: `assets/maps/dining-car.webp`

| pin | x | y | 必须画出来的东西 |
|---|---|---|---|
| tea-bill | 0.38 | 0.42 | 一张桌子的碟子下压着小票 |
| two-teacups | 0.44 | 0.36 | 同一张桌上两只没收的茶杯 |
| freight-key | 0.84 | 0.34 | 车厢尽头开水炉旁的铁皮煤斗，煤灰被拨乱 |
| player | 0.50 | 0.86 | 底部正中的过道 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an old railway dining car running left to right, 16:9. Tables with white cloths and small lamps along the windows; on one table left of centre two uncleared teacups and a small paper receipt under a saucer. A service counter on the left end with a cook's cap on it. At the right end a steaming hot-water boiler with an iron coal scuttle beside it, coal dust scattered and disturbed. The aisle along the bottom, entrance at the bottom centre, a door at the right end to the rear car. No people, no text.
```

### world/freight-car — 5车 · 行李车

Output: `assets/maps/freight-car.webp`

| pin | x | y | 必须画出来的东西 |
|---|---|---|---|
| su-he-testimony | 0.36 | 0.44 | 邮袋堆里的一个窝，一件深色女式大衣和一条红围巾 |
| 04-confront-dice | 0.72 | 0.30 | 角落的铁皮炉子，炉门开着，火快灭了 |
| player | 0.50 | 0.86 | 底部正中的车门 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an unheated railway baggage car running left to right, 16:9, frost on the steel walls. Piles of yellow jute mail sacks fill much of the floor; left of centre a hollow in the sacks with a woman's dark coat and a red scarf left in it. In the upper right corner a small iron stove with its door open and a dying orange fire. Parcels and crates along the walls. A sliding door at the bottom centre standing open, warm lamp light spilling in. No people, no text.
```

---

## 四、结局图（每个结局一张）

### found — 找到了她

Output: `assets/scenes/ending-found.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, no text, no watermark.
Dawn. The night train emerges from the mouth of a mountain tunnel into pale gold morning light over misty autumn ridges. Seen from beside the track, the last passenger cars catch the first sunlight; in one window, the silhouette of a young woman wrapped in a navy railway coat, another figure beside her. Hopeful, quiet, the darkness behind them. No readable text.
```

### departed — 列车开走了

Output: `assets/scenes/ending-departed.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, no text, no watermark.
Blue pre-dawn at a small mountain station platform. The night train has already pulled in; a black official car waits by the platform with its headlights on, a grey-coated figure walking toward it from behind, carrying a suitcase. At the far end of the train, the rear baggage car door open, a stretcher and two station workers in the cold mist. A single ember-edged scrap of paper drifts on the rails. Muted, melancholic. No readable text.
```

---

## 图到了以后要加的 frontmatter

只在对应文件真的存在后再加（缺图会让世界检查失败）：

| 文件 | key | 值 |
|---|---|---|
| `world.json` | `cover` | `assets/scenes/tunnel-train.webp` |
| `world.json` → `characters[id=xia-cheng]` | `avatar` | `assets/characters/xia-cheng.webp` |
| `world.json` → `characters[id=zhong-huaili]` | `avatar` | `assets/characters/zhong-huaili.webp` |
| `world.json` → `player` | `avatar` | `assets/characters/player.webp`（可选） |
| `characters/xia-cheng/README.md` | `avatar` | `assets/characters/xia-cheng.webp` |
| `characters/zhong-huaili/README.md` | `avatar` | `assets/characters/zhong-huaili.webp` |
| 苏禾 / 周子航 / 老秦 / 老贺 的 NPC 卡（`type: npc`） | `avatar` | `assets/characters/su-he.webp` / `zhou-zihang.webp` / `lao-qin.webp` / `lao-he.webp`（已接） |
| `world/README.md` | `bg` | `assets/scenes/tunnel-train.webp` |
| `world/cab/README.md` | `bg` | `assets/scenes/cab.webp` |
| `world/seated-car/README.md` | `bg` | `assets/scenes/seated-car.webp` |
| `world/sleeper/README.md` | `bg` | `assets/scenes/sleeper.webp` |
| `world/dining-car/README.md` | `bg` | `assets/scenes/dining-car.webp` |
| `world/freight-car/README.md` | `bg` | `assets/scenes/freight-car.webp` |
| `endings/found/README.md` | `bg` | `assets/scenes/ending-found.webp` |
| `endings/departed/README.md` | `bg` | `assets/scenes/ending-departed.webp` |

`map.plan.picture` 已经写在六个层 README 里（`assets/maps/<层>.webp`），不需要再加；生成后只需要把 `map.plan.pins` 对到画出来的位置。

## 物品图标（2026-09-28 交付）

透明底方形 WebP，放在 `assets/items/`，由物品卡 frontmatter 的 `image:` 显示（背包 / 物品详情的 `ItemArtwork`）。

| 图 | 接到哪里 |
|---|---|
| `passenger-list.webp` | `world/passenger-list.md` 的 `image`（已接） |
| `departure-clock.webp` | `world/departure-clock.md` 的 `image`（已接） |
| `repair-notice.webp` | `world/cab/repair-notice.md` 的 `image`（已接） |
| `tea-bill.webp` | `world/dining-car/tea-bill.md` 的 `image`（已接） |
| `two-teacups.webp` | `world/dining-car/two-teacups.md` 的 `image`（已接） |
| `su-he-notebook.webp` | `world/seated-car/su-he-notebook.md` 的 `image`（已接） |
| `grey-coat.webp` | `world/sleeper/grey-coat.md` 的 `image`（已接） |
| `key-board.webp` / `freight-key.webp` / `pill-strip.webp` / `logbook-page.webp` / `torn-corner.webp` | 未接：这五张卡由骰子 `dice_outcomes[].rewards` 在运行时生成，reward 条目目前只带 `path` / `title` / `body`（`apps/server/src/engine/declared-actions.ts`），带不上 `image`。引擎支持后在各 reward 上加 `image: assets/items/<id>.webp` |
