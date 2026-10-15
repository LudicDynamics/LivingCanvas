# 막차 · 이미지 생성 prompt

이미지는 모두 전달되어 연결되었다(장면, 지도, 결말 이미지, 샤청/중화이리/플레이어 일러스트가 먼저; 2026-09-28로 쑤허, 저우쯔항, 친 영감, 허 영감 네 NPC 일러스트와 12개의 아이템 아이콘을 채웠다. 문서 끝 「아이템 아이콘」 참조). 이 파일은 이 세계의 모든 이미지를 나열한다: 층마다 장면 이미지 한 장, 캐릭터마다 일러스트 한 장, 층마다 탑뷰 지도 한 장, 결말마다 결말 이미지 한 장. prompt는 영어로, 이미지 생성 모델에 바로 넣을 수 있게 한다.

## 사용법

1. 아래 prompt대로 생성해 **Output** 경로에 저장한다(WebP; PNG로 먼저 뽑은 뒤 변환해도 된다).
2. 지도: 각 층 README의 `map.plan.picture`에 파일명이 이미 적혀 있으니, 이미지를 넣으면 지도 모드에서 표시된다. 생성기는 핀 위치에 정확히 그려주지 않으므로, 생성 후 Claude가 이미지를 보고 `map.plan.pins`을 실제로 그려진 위치로 옮긴다.
3. 장면 이미지, 일러스트, 결말 이미지: 파일을 넣은 뒤 마지막 절 「이미지가 도착한 뒤 추가할 frontmatter」에 따라 key를 채운다. **이미지가 아직 없을 때는 이 key들을 추가하지 않는다**—세계 검사는 media 경로가 실제로 존재하기를 요구한다.

## 통일 화풍

장면 이미지와 결말 이미지(각 장면 prompt 앞에 붙인다, 아래에 이미 반영됨):

> Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.

지도(각 지도 prompt 앞에 붙인다, 아래에 이미 반영됨):

> Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.

지도 규칙: 16:9, 2048×1152(최소 1600×900). 핀 표의 각 항목을 해당 위치에 알아볼 수 있는 지표로 그린다, 사방에 6% 여백을 두고, 하단 중앙에 평온한 구간을 남긴다(자막과 플레이어가 거기 선다). **지도에는 사람을 그리지 않는다**—캐릭터는 게임이 직접 그리므로 핀 자리에는 빈 공간을 남긴다. 객차 탑뷰는 모두 긴 객차가 화면을 가로지르고, 통로는 화면 아래쪽을 따라가며, 입구 문은 하단 중앙에 있다.

---

## 일, 장면 이미지 (층마다 한 장)

### world — 단운 터널 · 멈춘 막차

Output: `assets/scenes/tunnel-train.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
A five-car night train stands motionless inside a long curved concrete railway tunnel, seen from the narrow maintenance walkway at a low three-quarter angle. Old green passenger cars with dim amber emergency lights in the windows, a sleeper car with drawn curtains, a dining car with a warm glow, and at the far rear a dark windowless baggage car with a padlocked sliding door. Far ahead beyond the locomotive, a pile of fallen rock and a single red warning lamp. Wet rails, dripping water, a railway wall clock on the tunnel wall near the front. No people, no text.
```

### world/cab — 1호차 · 운전실

Output: `assets/scenes/cab.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an old diesel locomotive cab at night. A worn control desk with dark gauges, only a small green light glowing on a radio set with a hanging handset. A notice paper clipped to the dashboard. On the right wall a wooden key board with rows of keys on red tags, one hook conspicuously empty. The windscreen shows the dark tunnel and a distant red warning lamp over fallen rocks. A lantern and muddy boots by the seat. No people, no readable text.
```

### world/seated-car — 2호차 · 경좌차

Output: `assets/scenes/seated-car.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an old hard-seat passenger car at night under dim amber emergency lights, rows of facing blue vinyl benches, passengers' coats and bags, the windows black with tunnel wall. In the foreground one empty window seat holds a canvas tote bag, a steel thermos and an open notebook with a yellowed newspaper clipping tucked inside. Further down, a student's backpack and earphones on a seat. The aisle leads toward the rear door. No faces in focus, no readable text.
```

### world/sleeper — 3호차 · 침대차

Output: `assets/scenes/sleeper.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
The narrow side corridor of an old soft-sleeper car at night, wood-panelled compartment doors mostly closed. One compartment door stands ajar; on a hook beside it hangs a grey wool overcoat, a few strands of yellow jute fibre caught on its hem. Through the gap: a lower berth with a white pillow and a half-open leather suitcase. Amber corridor lamps, dark windows. No people, no readable text.
```

### world/dining-car — 4호차 · 식당차

Output: `assets/scenes/dining-car.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an old railway dining car at night, white tablecloths, small table lamps. On one table two uncleared teacups, one with a pale residue at the bottom, and a small paper receipt pinned under a saucer. At the far end a steaming hot-water boiler and an iron coal scuttle beside it, coal dust scattered on the floor. A cook's white cap on the counter. A door at the end leads to the dark rear car. No people, no readable text.
```

### world/freight-car — 5호차 · 화물차

Output: `assets/scenes/freight-car.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, late-autumn night in a mountain railway tunnel, cold blue-grey darkness cut by warm amber emergency lamps, damp concrete and old green-painted rolling stock, quiet and tense mood, no text, no watermark.
Interior of an unheated railway baggage car, breath-fogging cold, frost on the steel walls. A mountain of yellow jute mail sacks; in a hollow among them a woman's dark coat and a red scarf, as if someone has been curled up there. In the corner a small iron stove with a dying orange fire, its door open. The sliding door at the end stands open, a lamp's glow spilling in from the car beyond. No people, no readable text.
```

---

## 이, 캐릭터 일러스트 (캐릭터마다 한 장)

통일: anime-painterly character portrait, waist-up, 3:4 또는 1:1, plain softly-lit dark backdrop (투명 배경이 더 좋다), no text.

### 샤청(xia-cheng, 동행자)

Output: `assets/characters/xia-cheng.webp`

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 24-year-old Chinese female train attendant in a navy railway uniform with a small cap and a brass name badge, short black bob, a passenger clipboard held to her chest, a flashlight clipped to her belt. Quick, earnest eyes, slightly anxious but determined expression. Warm amber emergency light from one side, cold blue shadow on the other. Plain dark background, no text.
```

### 중화이리(zhong-huaili)

Output: `assets/characters/zhong-huaili.webp`

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 62-year-old Chinese man, retired-official bearing, neat grey hair, rimless glasses, a long grey wool overcoat with his right hand resting on the inner breast pocket. Polite, composed half-smile that does not reach his eyes. Dim amber lamp light from below, deep shadows. Plain dark background, no text.
```

### 쑤허(su-he, 5호차 화물차에 있는 실종 승객)

Output: `assets/characters/su-he.webp`

전달됨(투명 배경). 그녀는 NPC 오브젝트 `world/freight-car/su-he.md`(`type: npc`, `avatar` 연결됨)이며 등록 캐릭터가 아니다; `su-he-testimony.md` 안의 일만 알고, 일지 페이지는 `04-confront-dice.md`의 판정으로만 넘겨줄 수 있다.

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 26-year-old Chinese woman who has just been found half-frozen among mail sacks in an unheated baggage car: shoulder-length black hair loose and messy, pale face, faintly purple lips, a long dark women's wool coat pulled tight around her with one hand clutching the empty inner breast pocket, a red knitted scarf half-slipped off one shoulder, frost on the coat's shoulders. Dazed, frightened but alert eyes looking straight at the viewer, as if about to speak. Cold blue light from one side, a warm amber lamp glow from below on the other. Plain dark background, no text.
```

### 저우쯔항(zhou-zihang, 2호차 20번 학생, NPC)

Output: `assets/characters/zhou-zihang.webp`

NPC 오브젝트(`type: npc`), 등록 캐릭터가 아니다; `witness-account.md` 안의 일만 안다.

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 20-year-old Chinese male university student sitting in a hard-seat train carriage at night: messy short black hair, thin-framed glasses, a grey hoodie under an open padded jacket, wired earphones hanging around his neck, a phone glowing faintly in one hand. Tired but wide-awake, uneasy eyes glancing sideways as if he has seen something he does not want to talk about. Cold blue light from the window side, warm amber emergency lamp from above. Plain dark background, no text.
```

### 친 영감(lao-qin, 1호차 운전실의 기관사, NPC)

Output: `assets/characters/lao-qin.webp`

NPC 오브젝트, 등록 캐릭터가 아니다; 자신이 0시 42분에 등불을 들고 내려 1시 5분에 돌아왔다는 것, 내리기 전 5호차 열쇠가 아직 판에 걸려 있었다는 것만 안다.

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 55-year-old Chinese locomotive driver: weathered square face, short grey stubble, a dark-blue railway work uniform with a faded shoulder patch, a padded work jacket, pale limestone dust on his shoulders and sleeves, holding an old railway hand lantern. Gruff, steady, worried eyes. Lit by the small green glow of a radio dial from below and a warm lamp from one side, cold blue shadow on the other. Plain dark background, no text.
```

### 허 영감(lao-he, 4호차 식당차의 요리사, NPC)

Output: `assets/characters/lao-he.webp`

NPC 오브젝트, 등록 캐릭터가 아니다; 식당차 카운터에서 졸고 있으며, 식당차에서 있었던 일만 안다.

```text
Anime-painterly character portrait, waist-up, soft cel shading. A 50-year-old Chinese train cook, heavy-set and round-faced, a white cook's jacket with rolled sleeves and a stained apron, a small white cap pushed back, a towel over one shoulder, just woken up with sleepy, slightly suspicious eyes and one hand on a metal counter. Warm steam and amber light from a hot-water boiler at his side, cool blue shadow behind. Plain dark background, no text.
```

### 플레이어(선택)

Output: `assets/characters/player.webp`

```text
Anime-painterly character portrait, waist-up, soft cel shading, seen slightly from behind over the shoulder. A young passenger in a plain dark parka with a scarf, face mostly turned away, holding a phone flashlight toward a dark train corridor. Plain dark background, no text.
```

---

## 삼, 탑다운 지도 (층마다 한 장)

### world — 터널에 멈춘 열차 전체

Output: `assets/maps/tunnel-train.webp`

| pin | x | y | 반드시 그려야 할 것 |
|---|---|---|---|
| cab | 0.12 | 0.45 | 열차 맨 앞의 기관차, 차머리는 왼쪽, 전방 멀리에 낙석 더미와 빨간 신호등 |
| seated-car | 0.31 | 0.45 | 두 번째 칸: 경좌차, 창문마다 어스름한 등불 한 줄 |
| sleeper | 0.50 | 0.45 | 세 번째 칸: 침대차, 커튼이 드리워져 있다 |
| dining-car | 0.69 | 0.45 | 네 번째 칸: 식당차, 창문 안 따뜻한 빛이 가장 밝다 |
| freight-car | 0.88 | 0.45 | 마지막 칸: 창문 없는 화물차, 옆문에 자물쇠가 걸려 있다 |
| departure-clock | 0.14 | 0.74 | 터널 벽에 걸린 철도 벽시계 (숫자는 그리지 않는다) |
| passenger-list | 0.34 | 0.72 | 점검 통로 위 종이를 끼운 클립보드 |
| xia-cheng | 0.44 | 0.66 | 통로 위 빈 공간 (캐릭터는 게임이 그린다) |
| player | 0.50 | 0.88 | 통로 아래쪽 정중앙, 평온한 구간 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Top-down view of a long straight railway tunnel running left to right across the frame, a five-car train standing on the rails in the middle band. From left to right: a diesel locomotive (nose pointing left, a pile of fallen rocks and a red warning lamp further left), a hard-seat passenger car with amber-lit windows, a sleeper car with curtained windows, a dining car glowing warmest, and a windowless dark baggage car with a padlocked side door at the far right. Below the train, a narrow concrete maintenance walkway with puddles; on the walkway near the front a clipboard with papers, and on the tunnel wall near the locomotive a round railway wall clock without numerals. Open walkway space in the centre-left and a calm stretch at the bottom centre. No people, no text.
```

### world/cab — 1호차 · 운전실

Output: `assets/maps/cab.webp`

| pin | x | y | 반드시 그려야 할 것 |
|---|---|---|---|
| repair-notice | 0.30 | 0.34 | 조작대 왼쪽에 끼워진 통지서 |
| 02-radio-report | 0.55 | 0.30 | 조작대 정중앙의 무전기, 작은 초록불이 켜져 있고 마이크가 걸려 있다 |
| key-board | 0.80 | 0.30 | 오른쪽 벽의 열쇠판, 빨간 패가 달린 열쇠 한 줄, 고리 하나가 비어 있다 |
| player | 0.50 | 0.86 | 하단 중앙 2호차로 통하는 문 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an old diesel locomotive cab, 16:9. Along the top edge a wide control desk under the windscreen: on its left a clipped paper notice, in its centre a radio set with a glowing green light and a coiled handset. On the right wall a wooden key board with a row of keys on red tags, one hook clearly empty. A driver's seat, a lantern and muddy boots on the floor. A door at the bottom centre leading back into the train. No people, no text.
```

### world/seated-car — 2호차 · 경좌차

Output: `assets/maps/seated-car.webp`

| pin | x | y | 반드시 그려야 할 것 |
|---|---|---|---|
| su-he-notebook | 0.42 | 0.40 | 비어 있는 창가 좌석: 캔버스 가방, 보온병, 펼쳐진 수첩 |
| witness-account | 0.66 | 0.40 | 다른 좌석의 학생 가방과 이어폰 |
| player | 0.50 | 0.86 | 하단 중앙의 통로 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of a long hard-seat passenger car running left to right, 16:9. Pairs of facing blue benches along the upper half by the windows, luggage racks above, coats and bags on some seats. Left of centre, one empty window seat holding a canvas tote bag, a steel thermos and an open notebook. Right of centre, a student's backpack and earphones on a seat. The aisle runs along the lower part; entrance at the bottom centre, doors at both ends. No people, no text.
```

### world/sleeper — 3호차 · 침대차

Output: `assets/maps/sleeper.webp`

| pin | x | y | 반드시 그려야 할 것 |
|---|---|---|---|
| grey-coat | 0.35 | 0.34 | 살짝 열린 객실 문 옆에 걸린 회색 모직 코트 |
| pill-strip | 0.62 | 0.30 | 그 객실 하단 침대의 흰 베개 |
| zhong-huaili | 0.62 | 0.52 | 객실 안 하단 침대 옆 바닥 한 조각(캐릭터는 게임이 그린다) |
| player | 0.50 | 0.86 | 하단 중앙의 측면 복도 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an old soft-sleeper car running left to right, 16:9. A row of wood-panelled four-berth compartments across the upper two thirds, doors mostly closed; one compartment slightly right of centre with its door ajar, a grey wool overcoat hanging on a hook by the door on the left side, inside a lower berth with a white pillow and a half-open leather suitcase, open floor beside the berth. A narrow side corridor along the bottom with amber lamps; entrance at the bottom centre. No people, no text.
```

### world/dining-car — 4호차 · 식당차

Output: `assets/maps/dining-car.webp`

| pin | x | y | 반드시 그려야 할 것 |
|---|---|---|---|
| tea-bill | 0.38 | 0.42 | 한 테이블의 접시 아래에 끼워진 영수증 |
| two-teacups | 0.44 | 0.36 | 같은 테이블 위에 치우지 않은 찻잔 두 개 |
| freight-key | 0.84 | 0.34 | 객차 끝 온수기 옆 철제 석탄통, 석탄재가 헤집어져 있다 |
| player | 0.50 | 0.86 | 하단 중앙의 통로 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an old railway dining car running left to right, 16:9. Tables with white cloths and small lamps along the windows; on one table left of centre two uncleared teacups and a small paper receipt under a saucer. A service counter on the left end with a cook's cap on it. At the right end a steaming hot-water boiler with an iron coal scuttle beside it, coal dust scattered and disturbed. The aisle along the bottom, entrance at the bottom centre, a door at the right end to the rear car. No people, no text.
```

### world/freight-car — 5호차 · 화물차

Output: `assets/maps/freight-car.webp`

| pin | x | y | 반드시 그려야 할 것 |
|---|---|---|---|
| su-he-testimony | 0.36 | 0.44 | 우편 자루 더미 속의 움푹한 자리, 짙은 색 여성용 코트와 빨간 목도리 |
| 04-confront-dice | 0.72 | 0.30 | 구석의 양철 난로, 난로 문이 열려 있고 불이 거의 꺼져 있다 |
| player | 0.50 | 0.86 | 아래쪽 정중앙의 차량 문 |

```text
Hand-painted game map in the same anime-painterly style, strict top-down view like a premium tabletop RPG battle map, cold blue-grey tunnel darkness with warm amber lamp pools, clean readable shapes, no text, no letters, no numbers, no labels, no grid, no UI, no frame, no watermark.
Strict top-down floor plan of an unheated railway baggage car running left to right, 16:9, frost on the steel walls. Piles of yellow jute mail sacks fill much of the floor; left of centre a hollow in the sacks with a woman's dark coat and a red scarf left in it. In the upper right corner a small iron stove with its door open and a dying orange fire. Parcels and crates along the walls. A sliding door at the bottom centre standing open, warm lamp light spilling in. No people, no text.
```

---

## 4. 결말 이미지 (결말마다 한 장)

### found — 그녀를 찾았다

Output: `assets/scenes/ending-found.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, no text, no watermark.
Dawn. The night train emerges from the mouth of a mountain tunnel into pale gold morning light over misty autumn ridges. Seen from beside the track, the last passenger cars catch the first sunlight; in one window, the silhouette of a young woman wrapped in a navy railway coat, another figure beside her. Hopeful, quiet, the darkness behind them. No readable text.
```

### departed — 열차가 떠났다

Output: `assets/scenes/ending-departed.webp`

```text
Anime-painterly background art, soft cel shading with painterly light, cinematic 16:9 composition, no text, no watermark.
Blue pre-dawn at a small mountain station platform. The night train has already pulled in; a black official car waits by the platform with its headlights on, a grey-coated figure walking toward it from behind, carrying a suitcase. At the far end of the train, the rear baggage car door open, a stretcher and two station workers in the cold mist. A single ember-edged scrap of paper drifts on the rails. Muted, melancholic. No readable text.
```

---

## 이미지가 도착한 뒤 추가할 frontmatter

해당 파일이 실제로 존재한 뒤에만 추가한다 (이미지가 없으면 세계 검사가 실패한다):

| 파일 | key | 값 |
|---|---|---|
| `world.json` | `cover` | `assets/scenes/tunnel-train.webp` |
| `world.json` → `characters[id=xia-cheng]` | `avatar` | `assets/characters/xia-cheng.webp` |
| `world.json` → `characters[id=zhong-huaili]` | `avatar` | `assets/characters/zhong-huaili.webp` |
| `world.json` → `player` | `avatar` | `assets/characters/player.webp` (선택) |
| `characters/xia-cheng/README.md` | `avatar` | `assets/characters/xia-cheng.webp` |
| `characters/zhong-huaili/README.md` | `avatar` | `assets/characters/zhong-huaili.webp` |
| 쑤허 / 저우쯔항 / 친 영감 / 허 영감의 NPC 카드 (`type: npc`) | `avatar` | `assets/characters/su-he.webp` / `zhou-zihang.webp` / `lao-qin.webp` / `lao-he.webp` (연결됨) |
| `world/README.md` | `bg` | `assets/scenes/tunnel-train.webp` |
| `world/cab/README.md` | `bg` | `assets/scenes/cab.webp` |
| `world/seated-car/README.md` | `bg` | `assets/scenes/seated-car.webp` |
| `world/sleeper/README.md` | `bg` | `assets/scenes/sleeper.webp` |
| `world/dining-car/README.md` | `bg` | `assets/scenes/dining-car.webp` |
| `world/freight-car/README.md` | `bg` | `assets/scenes/freight-car.webp` |
| `endings/found/README.md` | `bg` | `assets/scenes/ending-found.webp` |
| `endings/departed/README.md` | `bg` | `assets/scenes/ending-departed.webp` |

`map.plan.picture`은 이미 여섯 개 층 README에 적혀 있다 (`assets/maps/<층>.webp`). 추가할 필요는 없고, 생성 후에는 `map.plan.pins`를 그려진 위치에 맞추기만 하면 된다.

## 아이템 아이콘 (2026-09-28 납품)

투명 배경 정사각형 WebP, `assets/items/`에 넣고, 아이템 카드 frontmatter의 `image:`로 표시한다 (가방 / 아이템 상세의 `ItemArtwork`).

| 이미지 | 연결 위치 |
|---|---|
| `passenger-list.webp` | `world/passenger-list.md`의 `image` (연결됨) |
| `departure-clock.webp` | `world/departure-clock.md`의 `image` (연결됨) |
| `repair-notice.webp` | `world/cab/repair-notice.md`의 `image` (연결됨) |
| `tea-bill.webp` | `world/dining-car/tea-bill.md`의 `image` (연결됨) |
| `two-teacups.webp` | `world/dining-car/two-teacups.md`의 `image` (연결됨) |
| `su-he-notebook.webp` | `world/seated-car/su-he-notebook.md`의 `image` (연결됨) |
| `grey-coat.webp` | `world/sleeper/grey-coat.md`의 `image` (연결됨) |
| `key-board.webp` / `freight-key.webp` / `pill-strip.webp` / `logbook-page.webp` / `torn-corner.webp` | 미연결: 이 다섯 장의 카드는 주사위 `dice_outcomes[].rewards`이 런타임에 생성하며, reward 항목은 현재 `path` / `title` / `body`(`apps/server/src/engine/declared-actions.ts`)만 가지므로 `image`을 붙일 수 없다. 엔진이 지원하면 각 reward에 `image: assets/items/<id>.webp`을 추가한다 |
