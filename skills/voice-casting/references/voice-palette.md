# The voice palette

Every voice you may write in a character's `voice:` line. Pick by the sound, not by the name: the
left column is what you type, the right column is what it sounds like.

This file is GENERATED from `packages/shared/src/rules/voices.ts` — do not edit it by hand. To add
a voice, follow `docs/tts/07` (it must be observed to synthesise) and run
`node tools/check-voices.mjs --write-ref`.

## Female

| Alias | Sounds like |
|---|---|
| `warm-cheerful` | Sunny, warm, natural young woman — the friendly default. |
| `gentle-calm` | Soft-spoken and gentle, quietly attentive. |
| `anime-girlfriend` | Bright anime-style virtual-girlfriend voice. |
| `playful-teasing` | Playful and teasing, a little mischievous. |
| `sassy-spunky` | Sassy and prickly-cute, quick to snap. |
| `refined-thoughtful` | Composed and intellectual, with warmth underneath. |
| `mature-elegant` | Mature and elegant, richly cadenced. |
| `cinematic-american` | Polished, cinematic American English. |
| `shy-sweet` | Shy, sweet and yielding. |
| `moe-child` | High, hyper-cute cartoon-girl voice. |
| `bold-resonant` | Loud and clear; carries across a room. |
| `magical-girl` | Sweet and dreamy until it turns heroic. |
| `girl-next-door` | Sweet and affectionate, the girl next door. |
| `soothing-whisper` | Slow and soothing — a sleep-aid voice. |
| `child-innocent` | Small child: innocent and bright. |
| `spirited-girlfriend` | Wry, spirited childhood-friend voice. |
| `shanghai-auntie` | Shanghainese: brisk and no-nonsense. |
| `sichuan-sweetheart` | Sichuan-accented, sweet and warm. |
| `cantonese-sweetheart` | Cantonese: sweet and friendly. |

## Male

| Alias | Sounds like |
|---|---|
| `warm-energetic` | Sunny, warm, energetic young man. |
| `cool-composed` | Cool and detached, effortlessly confident. |
| `soothing-smooth` | Low and smooth — calm, relaxing read. |
| `casual-drawl` | Relaxed and casual, faintly mumbled. |
| `dramatic-theatrical` | Heightened and theatrical, full of tension. |
| `friendly-american` | Easygoing American young man. |
| `wise-elder` | Old and steady, deeply experienced — calm authority. |
| `hoarse-weathered` | Hoarse and smoky, weathered by years. |
| `news-anchor` | Flat and precise, a professional news-reader. |
| `scholarly-narrator` | Measured lecturer: clear and instructive. |
| `rustic-storyteller` | Rustic elder, unhurried, telling old tales. |
| `precocious-child` | Clever child: small but unnervingly articulate. |
| `deep-magnetic` | Deep and magnetic, comfortably steady. |
| `sportscaster` | Fast and excited sports-commentary delivery. |
| `beijing-youth` | Beijing-accented young man. |
| `nanjing-uncle` | Nanjing-accented, patient and gentle. |
| `shaanxi-elder` | Shaanxi-accented, terse and grounded. |
| `minnan-uncle` | Minnan-accented, wry and streetwise. |
| `tianjin-comic` | Tianjin-accented comic patter. |
| `sichuan-local` | Sichuan-accented, lively local man. |
| `cantonese-uncle` | Cantonese: humorous and chatty. |

Rule: two characters in the SAME world must not share a voice. Cross-world reuse is fine.
