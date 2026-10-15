# 終電 · 画像生成プロンプト

画像はすべて納品・接続済み（シーン、マップ、エンディング画像、夏澄／鐘懐礼／プレイヤー立ち絵が先。2026-09-28 で蘇禾、周子航、秦じい、賀じいの4枚のNPC立ち絵と12個のアイテムアイコンを補完、文末「アイテムアイコン」参照）。本ファイルはこの世界の全画像を列挙する：各階層にシーン画像1枚、各キャラクターに立ち絵1枚、各階層に俯瞰マップ1枚、各エンディングにエンディング画像1枚。プロンプトは英語、画像生成モデルに直接投入できるように。

## 使い方

1. 以下のプロンプトで生成し、**Output** パスに保存（WebP；先にPNGで出して変換してもよい）。
2. マップ：各階層のREADMEの`map.plan.picture`にファイル名がすでに書いてあり、画像を入れるとマップモードで表示される。生成器はピンの位置に正確に描かないので、生成後にClaudeに画像を見せ、`map.plan.pins`を実際に描かれた場所へ移動させる。
3. シーン画像、立ち絵、エンディング画像：ファイルを配置した後、最後の節「画像が届いた後に追加するfrontmatter」に従ってkeyを補う。**画像がまだ存在しないときはこれらのkeyを追加しない**——世界チェックはmediaパスが実在することを要求する。

## 統一画風

シーン画像とエンディング画像（各シーンのプロンプトの前に貼る、以下はすでに付帯済み）：

> Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.

マップ（各マップのプロンプトの前に貼る、以下はすでに付帯済み）：

> Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.

マップ規則：16:9、2048×1152（少なくとも1600×900）。ピン表の各項目は対応する位置に明確に識別できるランドマークとして描き、四辺に6%の余白、底部中央に平穏な一帯を残す（字幕とプレイヤーがそこに立つ）。**マップ上に人は描かない**——キャラクターはゲーム自身が描くので、ピンの位置には空き地を残す。車両の俯瞰図は一律、長方形の車両が画面を横断し、通路は画面下部に沿い、入口ドアは底部中央。

---

## 一、シーン画像（各階層に1枚）

### world — 断雲トンネル · 停まった終電

Output: `assets/scenes/tunnel-train.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
A five-car night train stands motionless inside a long curved concrete railway tunnel, seen from the narrow maintenance walkway at a low three-quarter angle. Old green passenger cars with dim amber emergency lights in the windows, a sleeper car with drawn curtains, a dining car with a warm glow, and at the far rear a dark windowless baggage car with a padlocked sliding door. Far ahead beyond the locomotive, a pile of fallen rock and a single red warning lamp. Wet rails, dripping water, a railway wall clock on the tunnel wall near the front. No people, no text.
```

### world/cab — 1号車・運転室

Output: `assets/scenes/cab.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an old diesel locomotive cab at night. A worn control desk with dark gauges, only a small green light glowing on a radio set with a hanging handset. A notice paper clipped to the dashboard. On the right wall a wooden key board with rows of keys on red tags, one hook conspicuously empty. The windscreen shows the dark tunnel and a distant red warning lamp over fallen rocks. A lantern and muddy boots by the seat. No people, no readable text.
```

### world/seated-car — 2号車・硬座車

Output: `assets/scenes/seated-car.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an old hard-seat passenger car at night under dim amber emergency lights, rows of facing blue vinyl benches, passengers' coats and bags, the windows black with tunnel wall. In the foreground one empty window seat holds a canvas tote bag, a steel thermos and an open notebook with a yellowed newspaper clipping tucked inside. Further down, a student's backpack and earphones on a seat. The aisle leads toward the rear door. No faces in focus, no readable text.
```

### world/sleeper — 3号車・寝台車

Output: `assets/scenes/sleeper.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
The narrow side corridor of an old soft-sleeper car at night, wood-panelled compartment doors mostly closed. One compartment door stands ajar; on a hook beside it hangs a grey wool overcoat, a few strands of yellow jute fibre caught on its hem. Through the gap: a lower berth with a white pillow and a half-open leather suitcase. Amber corridor lamps, dark windows. No people, no readable text.
```

### world/dining-car — 4号車・食堂車

Output: `assets/scenes/dining-car.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an old railway dining car at night, white tablecloths, small table lamps. On one table two uncleared teacups, one with a pale residue at the bottom, and a small paper receipt pinned under a saucer. At the far end a steaming hot-water boiler and an iron coal scuttle beside it, coal dust scattered on the floor. A cook's white cap on the counter. A door at the end leads to the dark rear car. No people, no readable text.
```

### world/freight-car — 5号車・荷物車

Output: `assets/scenes/freight-car.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an unheated railway baggage car, breath-fogging cold, frost on the steel walls. A mountain of yellow jute mail sacks; in a hollow among them a woman's dark coat and a red scarf, as if someone has been curled up there. In the corner a small iron stove with a dying orange fire, its door open. The sliding door at the end stands open, a lamp's glow spilling in from the car beyond. No people, no readable text.
```

---

## 二、キャラクター立ち絵（各キャラクターに1枚）

統一：anime-painterly character portrait, waist-up, 3:4 または 1:1, plain softly-lit dark backdrop (透明底更好), no text.

### 夏澄（xia-cheng、同行者）

Output: `assets/characters/xia-cheng.webp`

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 24-year-old Chinese female train attendant in a navy railway uniform with a small cap and a brass name badge, short black bob, a passenger clipboard held to her chest, a flashlight clipped to her belt. Quick, earnest eyes, slightly anxious but determined expression. Warm amber emergency light from one side, cold blue shadow on the other. Plain dark background, no text.
```

### 鐘懐礼（zhong-huaili）

Output: `assets/characters/zhong-huaili.webp`

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 62-year-old Chinese man, retired-official bearing, neat grey hair, rimless glasses, a long grey wool overcoat with his right hand resting on the inner breast pocket. Polite, composed half-smile that does not reach his eyes. Dim amber lamp light from below, deep shadows. Plain dark background, no text.
```

### 蘇禾（su-he、5号車荷物車にいる失踪乗客）

Output: `assets/characters/su-he.webp`

納品済み（透明底）。彼女はNPCオブジェクト`world/freight-car/su-he.md`（`type: npc`、`avatar`接続済み）であり、登録キャラクターではない；`su-he-testimony.md`の中のことしか知らず、日誌のページは`04-confront-dice.md`の判定によってのみ引き渡される。

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 26-year-old Chinese woman who has just been found half-frozen among mail sacks in an unheated baggage car: shoulder-length black hair loose and messy, pale face, faintly purple lips, a long dark women's wool coat pulled tight around her with one hand clutching the empty inner breast pocket, a red knitted scarf half-slipped off one shoulder, frost on the coat's shoulders. Dazed, frightened but alert eyes looking straight at the viewer, as if about to speak. Cold blue light from one side, a warm amber lamp glow from below on the other. Plain dark background, no text.
```

### 周子航（zhou-zihang、2号車20番の学生、NPC）

Output: `assets/characters/zhou-zihang.webp`

NPCオブジェクト（`type: npc`）であり、登録キャラクターではない；`witness-account.md`の中のことしか知らない。

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 20-year-old Chinese male university student sitting in a hard-seat train carriage at night: messy short black hair, thin-framed glasses, a grey hoodie under an open padded jacket, wired earphones hanging around his neck, a phone glowing faintly in one hand. Tired but wide-awake, uneasy eyes glancing sideways as if he has seen something he does not want to talk about. Cold blue light from the window side, warm amber emergency lamp from above. Plain dark background, no text.
```

### 秦じい（lao-qin、1号車運転室の運転士、NPC）

Output: `assets/characters/lao-qin.webp`

NPCオブジェクトであり、登録キャラクターではない；自分が0時42分に提灯を持って下車し、1時05分に戻ったこと、下車前に5号車の鍵がまだ板に掛かっていたことしか知らない。

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 55-year-old Chinese locomotive driver: weathered square face, short grey stubble, a dark-blue railway work uniform with a faded shoulder patch, a padded work jacket, pale limestone dust on his shoulders and sleeves, holding an old railway hand lantern. Gruff, steady, worried eyes. Lit by the small green glow of a radio dial from below and a warm lamp from one side, cold blue shadow on the other. Plain dark background, no text.
```

### 賀じい（lao-he、4号車食堂車の料理人、NPC）

Output: `assets/characters/lao-he.webp`

NPCオブジェクトであり、登録キャラクターではない；食堂車のカウンターで居眠りしており、食堂車で起きたことしか知らない。

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 50-year-old Chinese train cook, heavy-set and round-faced, a white cook's jacket with rolled sleeves and a stained apron, a small white cap pushed back, a towel over one shoulder, just woken up with sleepy, slightly suspicious eyes and one hand on a metal counter. Warm steam and amber light from a hot-water boiler at his side, cool blue shadow behind. Plain dark background, no text.
```

### プレイヤー（任意）

Output: `assets/characters/player.webp`

```text
Anime-painterly character portrait, waist-up, soft cel shading, seen slightly from behind over the shoulder. A young passenger in a plain dark parka with a scarf, face mostly turned away, holding a phone flashlight toward a dark train corridor. Plain dark background, no text.
```

---

## 三、俯瞰マップ（各階層に1枚）

### world — トンネルに停まった列車全体

Output: `assets/maps/tunnel-train.webp`

| pin | x | y | 必ず描くもの |
|---|---|---|---|
| cab | 0.12 | 0.45 | 列車最先端の機関車、車頭は左向き、前方遠くに落石の山と赤信号 |
| seated-car | 0.31 | 0.45 | 二両目：硬座車、窓に一排の昏黄の灯 |
| sleeper | 0.50 | 0.45 | 三両目：寝台車、カーテンが引かれている |
| dining-car | 0.69 | 0.45 | 四両目：食堂車、窓の中の暖光が最も明るい |
| freight-car | 0.88 | 0.45 | 最後尾：窓のない荷物車、側扉に錠が掛かっている |
| departure-clock | 0.14 | 0.74 | トンネル壁に鉄道の掛け時計（数字は描かない） |
| passenger-list | 0.34 | 0.72 | 点検歩道に紙を挟んだ筆記板 |
| xia-cheng | 0.44 | 0.66 | 歩道の空き地（キャラクターはゲームが描く） |
| player | 0.50 | 0.88 | 歩道底部中央、平穏な一帯 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Top-down view of a long straight railway tunnel running left to right across the frame, a five-car train standing on the rails in the middle band. From left to right: a diesel locomotive (nose pointing left, a pile of fallen rocks and a red warning lamp further left), a hard-seat passenger car with amber-lit windows, a sleeper car with curtained windows, a dining car glowing warmest, and a windowless dark baggage car with a padlocked side door at the far right. Below the train, a narrow concrete maintenance walkway with puddles; on the walkway near the front a clipboard with papers, and on the tunnel wall near the locomotive a round railway wall clock without numerals. Open walkway space in the centre-left and a calm stretch at the bottom centre. No people, no text.
```

### world/cab — 1号車・運転室

Output: `assets/maps/cab.webp`

| pin | x | y | 必ず描くもの |
|---|---|---|---|
| repair-notice | 0.30 | 0.34 | 操作台の左に通知が挟まっている |
| 02-radio-report | 0.55 | 0.30 | 操作台中央の無線、小さな緑ランプが点灯、送受話器が掛かっている |
| key-board | 0.80 | 0.30 | 右側の壁の鍵板、一排の赤札鍵、一つだけフックが空いている |
| player | 0.50 | 0.86 | 底部中央、2号車へ通じるドア |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an old diesel locomotive cab, 16:9. Along the top edge a wide control desk under the windscreen: on its left a clipped paper notice, in its centre a radio set with a glowing green light and a coiled handset. On the right wall a wooden key board with a row of keys on red tags, one hook clearly empty. A driver's seat, a lantern and muddy boots on the floor. A door at the bottom centre leading back into the train. No people, no text.
```

### world/seated-car — 2号車・硬座車

Output: `assets/maps/seated-car.webp`

| pin | x | y | 必ず描くもの |
|---|---|---|---|
| su-he-notebook | 0.42 | 0.40 | 空いた窓側の席：帆布の鞄、保温ボトル、開いたノート |
| witness-account | 0.66 | 0.40 | 別の席の学生鞄とヘッドホン |
| player | 0.50 | 0.86 | 底部中央の通路 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of a long hard-seat passenger car running left to right, 16:9. Pairs of facing blue benches along the upper half by the windows, luggage racks above, coats and bags on some seats. Left of centre, one empty window seat holding a canvas tote bag, a steel thermos and an open notebook. Right of centre, a student's backpack and earphones on a seat. The aisle runs along the lower part; entrance at the bottom centre, doors at both ends. No people, no text.
```

### world/sleeper — 3号車・寝台車

Output: `assets/maps/sleeper.webp`

| pin | x | y | 必ず描くもの |
|---|---|---|---|
| grey-coat | 0.35 | 0.34 | 半開きの個室ドアの脇に掛かったグレーのウールコート |
| pill-strip | 0.62 | 0.30 | その個室の下段寝台の白い枕 |
| zhong-huaili | 0.62 | 0.52 | 個室の下段寝台脇の床の一区画（キャラクターはゲームが描く） |
| player | 0.50 | 0.86 | 底部中央の側通路 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an old soft-sleeper car running left to right, 16:9. A row of wood-panelled four-berth compartments across the upper two thirds, doors mostly closed; one compartment slightly right of centre with its door ajar, a grey wool overcoat hanging on a hook by the door on the left side, inside a lower berth with a white pillow and a half-open leather suitcase, open floor beside the berth. A narrow side corridor along the bottom with amber lamps; entrance at the bottom centre. No people, no text.
```

### world/dining-car — 4号車・食堂車

Output: `assets/maps/dining-car.webp`

| pin | x | y | 必ず描くもの |
|---|---|---|---|
| tea-bill | 0.38 | 0.42 | あるテーブルの受け皿の下に挟まったレシート |
| two-teacups | 0.44 | 0.36 | 同じテーブルの上に片付けられていない二つの茶碗 |
| freight-key | 0.84 | 0.34 | 車両の端、湯沸かし器の脇のブリキの石炭入れ、石炭灰がかき乱されている |
| player | 0.50 | 0.86 | 底部中央の通路 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an old railway dining car running left to right, 16:9. Tables with white cloths and small lamps along the windows; on one table left of centre two uncleared teacups and a small paper receipt under a saucer. A service counter on the left end with a cook's cap on it. At the right end a steaming hot-water boiler with an iron coal scuttle beside it, coal dust scattered and disturbed. The aisle along the bottom, entrance at the bottom centre, a door at the right end to the rear car. No people, no text.
```

### world/freight-car — 5号車・荷物車

Output: `assets/maps/freight-car.webp`

| pin | x | y | 必ず描くもの |
|---|---|---|---|
| su-he-testimony | 0.36 | 0.44 | 郵袋の山の中のくぼみ、濃い色の女性用コートと赤いマフラー |
| 04-confront-dice | 0.72 | 0.30 | 隅のブリキのストーブ、扉は開いていて、火が消えかけている |
| player | 0.50 | 0.86 | 下部中央の車扉 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an unheated railway baggage car running left to right, 16:9, frost on the steel walls. Piles of yellow jute mail sacks fill much of the floor; left of centre a hollow in the sacks with a woman's dark coat and a red scarf left in it. In the upper right corner a small iron stove with its door open and a dying orange fire. Parcels and crates along the walls. A sliding door at the bottom centre standing open, warm lamp light spilling in. No people, no text.
```

---

## 四、結末図（各結末に一枚）

### found — 彼女を見つけた

Output: `assets/scenes/ending-found.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, no text, no watermark.
Dawn. The night train emerges from the mouth of a mountain tunnel into pale gold morning light over misty autumn ridges. Seen from beside the track, the last passenger cars catch the first sunlight; in one window, the silhouette of a young woman wrapped in a navy railway coat, another figure beside her. Hopeful, quiet, the darkness behind them. No readable text.
```

### departed — 列車は発車した

Output: `assets/scenes/ending-departed.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, no text, no watermark.
Blue pre-dawn at a small mountain station platform. The night train has already pulled in; a black official car waits by the platform with its headlights on, a grey-coated figure walking toward it from behind, carrying a suitcase. At the far end of the train, the rear baggage car door open, a stretcher and two station workers in the cold mist. A single ember-edged scrap of paper drifts on the rails. Muted, melancholic. No readable text.
```

---

## 図が届いた後に追加する frontmatter

対応するファイルが本当に存在してから追加する（図が欠けるとワールドチェックが失敗する）：

| ファイル | key | 値 |
|---|---|---|
| `world.json` | `cover` | `assets/scenes/tunnel-train.webp` |
| `world.json` → `characters[id=xia-cheng]` | `avatar` | `assets/characters/xia-cheng.webp` |
| `world.json` → `characters[id=zhong-huaili]` | `avatar` | `assets/characters/zhong-huaili.webp` |
| `world.json` → `player` | `avatar` | `assets/characters/player.webp`（任意） |
| `characters/xia-cheng/README.md` | `avatar` | `assets/characters/xia-cheng.webp` |
| `characters/zhong-huaili/README.md` | `avatar` | `assets/characters/zhong-huaili.webp` |
| 蘇禾 / 周子航 / 秦じい / 賀じい の NPC カード（`type: npc`） | `avatar` | `assets/characters/su-he.webp` / `zhou-zihang.webp` / `lao-qin.webp` / `lao-he.webp`（接続済み） |
| `world/README.md` | `bg` | `assets/scenes/tunnel-train.webp` |
| `world/cab/README.md` | `bg` | `assets/scenes/cab.webp` |
| `world/seated-car/README.md` | `bg` | `assets/scenes/seated-car.webp` |
| `world/sleeper/README.md` | `bg` | `assets/scenes/sleeper.webp` |
| `world/dining-car/README.md` | `bg` | `assets/scenes/dining-car.webp` |
| `world/freight-car/README.md` | `bg` | `assets/scenes/freight-car.webp` |
| `endings/found/README.md` | `bg` | `assets/scenes/ending-found.webp` |
| `endings/departed/README.md` | `bg` | `assets/scenes/ending-departed.webp` |

`map.plan.picture` はすでに六つの層 README に書かれている（`assets/maps/<層>.webp`）ので追加不要；生成後は `map.plan.pins` を描かれた位置に合わせるだけでよい。

## アイテムアイコン（2026-09-28 納品）

透明背景の正方形 WebP、`assets/items/` に置き、アイテムカード frontmatter の `image:` で表示される（バックパック / アイテム詳細の `ItemArtwork`）。

| 図 | 接続先 |
|---|---|
| `passenger-list.webp` | `world/passenger-list.md` の `image`（接続済み） |
| `departure-clock.webp` | `world/departure-clock.md` の `image`（接続済み） |
| `repair-notice.webp` | `world/cab/repair-notice.md` の `image`（接続済み） |
| `tea-bill.webp` | `world/dining-car/tea-bill.md` の `image`（接続済み） |
| `two-teacups.webp` | `world/dining-car/two-teacups.md` の `image`（接続済み） |
| `su-he-notebook.webp` | `world/seated-car/su-he-notebook.md` の `image`（接続済み） |
| `grey-coat.webp` | `world/sleeper/grey-coat.md` の `image`（接続済み） |
| `key-board.webp` / `freight-key.webp` / `pill-strip.webp` / `logbook-page.webp` / `torn-corner.webp` | 未接続：この五枚のカードはダイス `dice_outcomes[].rewards` が実行時に生成し、reward エントリは現在 `path` / `title` / `body`（`apps/server/src/engine/declared-actions.ts`）しか持たず、`image` を持てない。エンジンが対応したら各 reward に `image: assets/items/<id>.webp` を追加する |
