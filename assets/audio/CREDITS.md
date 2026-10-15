# Audio Credits

> **Open-source copy:** the MaouDamashii files (`themes/canvas-*.mp3`, `foley/canvas/se-*.mp3`) and everything under `licensed/` may not be redistributed and are **not included**. Their rows stay below as a record; without them the game plays the CC0 / CC-BY track or foley of the same role (`fallback` in `packages/shared/src/rules/music.ts`).

The original tracks in this directory were sourced via the `search_audio`
tool (Freesound previews). They were re-encoded to **128 kbps MP3** and
trimmed/faded for game use. Provenance recorded for reproducibility.

**License policy**: CC0 preferred; CC-BY accepted with attribution (see §5);
**CC-BY-NC rejected entirely** — this repo is a public hackathon artifact and
the demo may be shown commercially.

---

## Worldlines Canvas full-length themes

Music: MaouDamashii (Koichi Morita) — https://maou.audio/
Used under the creator's usage terms, with attribution retained from
`worldlines-canvas/app/media/CREDITS.md`. These are not CC0 tracks.
Copied byte-for-byte from `worldlines-canvas/app/media/`; no trimming,
re-encoding, or generation. World mapping follows `app/src/app.js` BGM_TRACKS.
The original Freesound theme pool below is retained, not overwritten.

| Imported file | Original file | Track | World |
|---|---|---|---|
| `themes/canvas-mistport.mp3` | `maou_bgm_piano36.mp3` | Piano 36 | last-train 末班车 (2026-10-03; mistport migration pending) |
| `themes/canvas-wuwu.mp3` | `maou_bgm_fantasy13.mp3` | Fantasy 13 | wuwu |
| `themes/canvas-whitechapel.mp3` | `maou_bgm_orchestra26.mp3` | Orchestra 26 | whitechapel |
| `themes/canvas-divergence.mp3` | `maou_bgm_healing17.mp3` | Healing 17 | divergence |
| `themes/canvas-firstsnow.mp3` | `maou_bgm_acoustic54.mp3` | Acoustic 54 | firstsnow |

The four migrated Canvas worlds select these full tracks through
`world.json` `audio.theme: canvas-<world>`. Playback follows the existing
theme/layer-BGM precedence and requires the first browser interaction.

## 1. BGM — `bgm/` (3 moods, selected by the layer README `bgm` field; crossfaded 1.5s)

| File | Key | Title | Artist | ID | Dur | License |
|---|---|---|---|---|---|---|
| `bgm/calm.mp3` | calm | Piano Song Loop #4 Childhood | Kleber_KGF | 355071 | 37s | CC0 1.0 |
| `bgm/tense.mp3` | tense | Dark Atmospheric Drone (Seamless Loop) | kkenny101 | 865550 | 158s | CC0 1.0 |
| `bgm/crisis.mp3` | crisis | Fight Music Synth Tense Loop | SnowFightStudios | 676998 | 97s | CC0 1.0 |

## 2. World themes — `themes/` (per-world identity)

| File | World | Title | Artist | ID | Dur | License |
|---|---|---|---|---|---|---|
| `themes/wuwu.mp3` | 雾坞镇 | Pirate Tavern | brunoboselli | 695295 | 61s | CC0 1.0 |
| `themes/whitechapel.mp3` | 雾都来信 | Detective Hawkeye | Victor_Natas | 624600 | 43s | **CC-BY 4.0 §5** |
| `themes/divergence.mp3` | 分歧点 | Retro — Generative Sound by Glorb | bassimat | 855476 | 120s | CC0 1.0 |
| `themes/firstsnow.mp3` | 未写之门 (2026-10-03; formerly 初雪电台) | Awesome Emotional Piano | Endersniper123 | 215767 | 64s | CC0 1.0 |
| `themes/emberglass.mp3` | 烬晶学院 | Mystical/fantasy loop | nicorico_120 | 858160 | 55s | CC0 1.0 |
| `themes/mandongbu.mp3` | 漫动部 | School Day (Loop) | kiluaboy (OpenGameArt) | [school-day-rain-sun-loop](https://opengameart.org/content/school-day-rain-sun-loop) | 85s | CC0 1.0 |
| `themes/guixiang.mp3` | 归乡（客家民俗恐怖） | Karst Mountains + Dark Atmospheric Drone | neolein + kkenny101 | 664200 + 865550 | 104s | CC0 1.0 |

`themes/mandongbu.mp3` comes from OpenGameArt, not Freesound. It replaces
`themes/firstsnow.mp3` as the 漫动部 theme, which had sounded eerie. The source file is
`https://opengameart.org/sites/default/files/SchoolDay.wav` (the dry take, without
the rain or sun weather layers). It was loudness-matched with a linear gain to
about −23.7 LUFS, close to the old theme's −23.5, and encoded at 128 kbps / 44.1 kHz.
It keeps its full length, with only a 50 ms tail fade so the loop joins cleanly.
漫动部 layers no longer set `bgm:` (the old calm/tense beds played on top of the theme),
so the theme is the only music track, as in the other worlds.

`themes/guixiang.mp3` is the theme for 归乡, a Hakka folk-horror workshop world, and the
default theme of the `infinite` world type. It is a blend of two CC0 Freesound tracks:
**Karst Mountains** by neolein (https://freesound.org/s/664200/; guzheng with pads,
tagged chinese / mystic) over **Dark Atmospheric Drone** by kkenny101
(https://freesound.org/s/865550/, the same file as `bgm/tense.mp3`), about 10 LU lower.
No CC0 track with erhu, dizi or guzheng was eerie enough on its own, so the drone
adds the dread and covers the guzheng's decay at the loop point. How it was made:
the leading 0.45 s of silence and the trailing 5 s were trimmed from the guzheng
(the -hq preview). The drone was cut to the same 104 s, and its own head was
crossfaded into its tail (3 s) so it loops without a jump. The two were mixed with
a linear gain to −23.5 LUFS, given a 50 ms tail fade, and encoded at 128 kbps /
44.1 kHz stereo.

## 3. Ambient base — `ambient/` (3 core beds, crossfaded on layer change 1.5s)

| File | Key | Title | Artist | ID | Dur | License |
|---|---|---|---|---|---|---|
| `ambient/rain.mp3` | rain | Forest Rainstorm 01 | rifualk | 648474 | 60s | CC0 1.0 |
| `ambient/fireplace.mp3` | fireplace | Fireplace crackling wood little flame | BonnyOrbit | 484338 | 60s | CC0 1.0 |
| `ambient/cellar-drip.mp3` | cellar-drip | Water Dripping in Cave | Sclolex | 177958 | 60s | CC0 1.0 |

## 4. Ambient pool — `ambient/pool/` (reusable scene beds, trimmed to 60s)

| File | Scene family | Title | Artist | ID | Dur | License |
|---|---|---|---|---|---|---|
| `pool/storm.mp3` | 暴雨 + 雷 | Thunderstorm, Moderate Rain, Thunderclaps | newlocknew | 859807 | 60s | CC0 1.0 |
| `pool/snow-wind.mp3` | 冬夜寒风 + 落雪 | Winter Snowstorm Ambience | HECKFRICKER | 754256 | 60s | CC0 1.0 |
| `pool/harbor-waves.mp3` | 港口浪拍 + 船索 | SeaWaves Pack | Liancu | 515238 | 60s | CC0 1.0 |
| `pool/library.mp3` | 图书馆静默 | Library Ambience (large space) | Hupguy | 138259 | 60s | CC0 1.0 |
| `pool/city-night.mp3` | 冬夜街道 | city night 0329 AM | klankbeeld | 771212 | 60s | **CC-BY 4.0 §5** |
| `pool/office-night.mp3` | 深夜办公室空旷 | Office ambience | Chelly01 | 541117 | 60s | CC0 1.0 |
| `pool/cave-drip.mp3` | 洞穴滴水（恐怖变体） | cave dripping water | mentos987 | 818888 | 29s | CC0 1.0 |
| `pool/tavern-chatter.mp3` | 酒馆压低人声 | background chatter tavern | dazzamoo | 651364 | 60s | CC0 1.0 |
| `pool/cafe-murmur.mp3` | 咖啡馆人声 + 杯碟 | restaurant ambience | soundtracvkradio | 394678 | 60s | CC0 1.0 |
| `pool/bell-church.mp3` | 教堂钟声 | Church Bells, Distant | InspectorJ | 398195 | 31s | **CC-BY 4.0 §5** |
| `pool/forge.mp3` | 铁匠铺风箱 + 炉火 | Forge — Coal burning | ldezem | 386146 | 24s | CC0 1.0 |

## 5. Attribution required (CC-BY 4.0)

Three tracks are **CC-BY 4.0**, which legally requires attribution. If these
are used in any public/distributed build, credit them:

- **Detective Hawkeye** by Victor_Natas — https://freesound.org/s/624600/ (CC BY 4.0)
- **city night 0329 AM** by klankbeeld — https://freesound.org/s/771212/ (CC BY 4.0)
- **Church Bells, Distant** by InspectorJ — https://freesound.org/s/398195/ (CC BY 4.0)

## 6. Foley — `foley/` (interaction one-shots)

The current UI uses `foley/canvas/se-*.mp3`, copied byte-for-byte from
`worldlines-canvas/app/media/se/`. Sound effects: MaouDamashii (Koichi Morita),
https://maou.audio/ — used under the creator's usage terms, not CC0.
Original attribution: `worldlines-canvas/app/media/CREDITS.md`.
Tracks: get = System 20; paper = System 35; door = Zippo opening;
bell = System 40; write = System 28; dice = One Point 26;
success = One Point 21; card = System 44. Bell is the new-scene title sting (`scene-sting`) and get also sounds an item obtained (`item-get`), the design notes
Playback levels follow Canvas (0.14–0.28); repeated instances of the same
effect cannot overlap. The older Freesound files below are retained.

| File | Key | Title | Artist | ID | Dur | License |
|---|---|---|---|---|---|---|
| `foley/paper-slide.mp3` | paper-slide | paper_rustle_1 | StarTowerStudio | 426816 | 1.5s | CC0 1.0 |
| `foley/bag-pack.mp3` | bag-pack | Suitcase Latch | ThunderQuads | 467205 | 1.5s | CC0 1.0 |
| `foley/dice-roll.mp3` | dice-roll | 10-Sided Die Rolled on Wood Table | aunrea | 485946 | 2.2s | CC0 1.0 |
| `foley/unlock.mp3` | unlock | Key_Insert | schoman3 | 506912 | 1.0s | CC0 1.0 |
| `foley/pen-scratch.mp3` | pen-scratch | Pen writing on paper (close up) | khenshom | 565206 | 2.0s | CC0 1.0 |
| `foley/gate-open.mp3` | gate-open | creaking-door-open01 | Aiyumi | 244425 | 1.1s | CC0 1.0 |
| `foley/crit-chime.mp3` | crit-chime | Little bell | NikoletB | 846674 | 2.5s | CC0 1.0 |
| `foley/fumble-break.mp3` | fumble-break | Snap | Lucky_Diamond555 | 319730 | 2.0s | CC0 1.0 |
| `foley/page-turn.mp3` | page-turn | Book page turning | eZZin | 641757 | 1.8s | CC0 1.0 |

## 7. Stinger — `stinger/` (6 emotion one-shots, **PENDING**)

| File | Key | Title | Artist | ID | Dur | License |
|---|---|---|---|---|---|---|
| `stinger/normal.mp3`   | normal   | TBD | TBD | TBD | <1.5s | TBD |
| `stinger/smile.mp3`    | smile    | TBD | TBD | TBD | <1.5s | TBD |
| `stinger/shock.mp3`    | shock    | TBD | TBD | TBD | <1.5s | TBD |
| `stinger/sad.mp3`      | sad      | TBD | TBD | TBD | <1.5s | TBD |
| `stinger/angry.mp3`    | angry    | TBD | TBD | TBD | <1.5s | TBD |
| `stinger/thinking.mp3` | thinking | TBD | TBD | TBD | <1.5s | TBD |

> Not yet produced. Once wired, `playStinger(emo)` maps to `stinger/<emo>.mp3`; a
> missing file is a silent no-op (it never touches the BGM main track).

## 8. Licensed, local only — `licensed/` (gitignored, **not in the repository**)

| File | Use | Title | Artist | Source | Dur | License |
|---|---|---|---|---|---|---|
| `licensed/launcher.mp3` | World launcher theme (`LAUNCHER_THEME`) | 弹幕翻页夜 (seamless 3s-crossfade loop, −20 LUFS) | the team (made with Suno) | `licensed/suno-danmaku-night.mp3` | 57s | Suno terms (owner's plan) |
| `licensed/suno-danmaku-night.mp3` | original of the above | 弹幕翻页夜 | the team (made with Suno) | local file | 60s | Suno terms (owner's plan) |
| `licensed/launcher-healing17.mp3` | previous launcher theme | ヒーリング17 (loudness-matched, −23.9 LUFS) | 魔王魂 (森田交一) | https://maou.audio/bgm_healing17/ | 178s | 魔王魂 terms |
| `licensed/maou_bgm_healing17.mp3` | original of the above | ヒーリング17 | 魔王魂 | https://maou.audio/bgm_healing17/ | 178s | 魔王魂 terms |
| `licensed/maou_bgm_fantasy06.mp3` | alternative (grand opening) | ファンタジー06 | 魔王魂 | https://maou.audio/bgm_fantasy06/ | 100s | 魔王魂 terms |
| `licensed/maou_bgm_piano41.mp3` | alternative (quiet, mysterious piano) | ピアノ41 Last daily sound 2 | 魔王魂 | https://maou.audio/bgm_piano41/ | 85s | 魔王魂 terms |

> 魔王魂 terms (https://maou.audio/rule/): free for personal and commercial use;
> **credit required** — the launcher shows 「音楽：魔王魂」; **redistributing the
> track files themselves is prohibited**, so this folder stays out of git. Download
> the files from the pages above on each machine; without them the launcher is silent.

---

## Notes

- **`worldlines-assets/` had no audio** — only images (375 PNG / 15 JPG). These
  files are the first audio produced for the assets workshop.
- **Runtime status**: wired — `apps/web/src/lib/audio.ts` plays these files
  (sample-first, synth as offline fallback); the synth engine is retained as the
  T3.8 degradation path. Layer selection comes from the layer README
  `ambient`/`bgm` fields; world themes from `world.json` `audio.theme`
.
- **Full upstream URLs** follow the pattern
  `https://cdn.freesound.org/previews/<id/1000>/<id>_<userid>-hq.mp3`.

- **Coverage**: `bgm/` (3 moods) + `ambient/` (3 beds) + `ambient/pool/` (11 scene
  beds) + `themes/` (7 world themes) + `foley/` (9 one-shots) = 32 files.
  `gate-open` is downloaded but has **no callsite** this batch (reserved for the
  T4.3 gate transition); `page-turn` likewise awaits the book/pages layer.
  `stinger/` is defined but unproduced (6 files).
