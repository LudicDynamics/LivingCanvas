# Content license

The **code** in this repository is licensed under the [Apache License 2.0](LICENSE).

The **content** listed below is licensed under the
**Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)**:
<https://creativecommons.org/licenses/by-nc/4.0/legalcode>

Copyright © 2026 Ludic Dynamics.

## What counts as content

| Path | What it is |
|---|---|
| `templates/**` | The bundled worlds (listed below): world files, scene and character text, character sheets, world skills, images and animations |
| `presets/**` | The writer, character and scene prompts |
| `skills/**` | The agent skills (instructions and examples) |
| `assets/models/**` | 3D models (the dice) and their textures |
| `apps/web/public/materials/**` | Paper and decoration textures |
| `apps/web/src/assets/**` | Plan and membership illustrations, UI textures |

Where a file under these paths says otherwise (its own license or credit file), that file wins.

## The bundled worlds

This repository carries these worlds, each with its `-jp`, `-zh` and `-ko` editions:

| World | Folders |
|---|---|
| Fogwharf: Before the Tide | `templates/wuwu*` |
| Holmes: The Fourth Case | `templates/whitechapel*` |
| The Last Train, and The Last Train · Prologue | `templates/last-train*`, `templates/last-train-prologue*` |
| The Unwritten Door | `templates/unwritten-door*` |
| The Moonlit Pact | `templates/moonlit-contract*` |
| Magic Academy (by Mingyue) | `templates/magic-academy*` |
| Shiomi Isle | `templates/islet*` |

**Remixing is welcome.** Under CC BY-NC 4.0 you may copy these worlds, change them and build on them — new scenes, sequels, translations, other characters, a world of your own that starts from one of them — and share the result, as long as it is non-commercial and carries the credit below. Other worlds of the hosted service are not in this repository and are not licensed here.

## What is *not* covered

- **Names and logos.** `apps/web/public/brand/**`, `tools/brand/**` and the names "LivingCanvas" and "Worldlines" are trademarks of Ludic Dynamics and are not licensed. See [TRADEMARKS.md](TRADEMARKS.md).
- **Third-party audio.** `assets/audio/**` contains CC0 and CC BY 4.0 works by others, under their own licenses. See [`assets/audio/CREDITS.md`](assets/audio/CREDITS.md).
- **Code.** Prompt text that is part of the source code (`apps/**/*.ts`, `extensions/**`, `packages/**`) is covered by Apache-2.0.

## Attribution

When you share or adapt this content, credit it as:

> "*World or asset name*" from LivingCanvas by Ludic Dynamics, CC BY-NC 4.0. Say whether you changed it.

A remix that is itself shared must be shared non-commercially too, with the same credit.

## Notes

- "Holmes: The Fourth Case" (`templates/whitechapel*`) uses public-domain characters from Arthur Conan Doyle. The text and art are original.
- "Magic Academy" (`templates/magic-academy*`) was written by Mingyue and is included with permission under the same license, remixing included. Credit it as "*Magic Academy* by Mingyue, from LivingCanvas by Ludic Dynamics, CC BY-NC 4.0".
- NonCommercial means you may not use this content mainly for commercial advantage or money. To use it commercially, ask at info@worldlines.gg.
