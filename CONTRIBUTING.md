# Contributing to LivingCanvas

Thanks for your interest! Issues and pull requests are welcome.

## Before you start

- **Bugs**: open an issue with the template. Say how to reproduce it, which world you were in, and whether you were running local Node or browser mode.
- **Bigger changes** (a new mechanic, a new agent tool, a protocol change): please open an issue first so we can agree on the shape before you write the code.
- **Security problems**: see [SECURITY.md](SECURITY.md), not the issue tracker.

## Where to start

- [Architecture and the turn loop](guide/architecture.md): how a player beat travels from the canvas through the writer and the engine and back.
- [Writing a world](guide/world-authoring.md): the world format, dice, endings, clocks and loops.
- [Configuration reference](guide/configuration.md): keys, models and switches.
- [Open source at LivingCanvas](guide/open-source.md): what is in this repository and how it is licensed.

## Development

```bash
git clone --recurse-submodules https://github.com/LudicDynamics/LivingCanvas.git
(cd vendor/pi-rp && npm install) && pnpm install && pnpm pi build
pnpm build
pnpm test
```

- TypeScript, strict mode. Follow the style of the code around you.
- Every behaviour change comes with a test (`node --test`, see `pnpm test`).
- The contract checks (`pnpm check:i18n`, `check:worlds`, `check:skills`, `check:ux`, `check:bodies`, `check:voices`, `check:effects`) must stay clean.
- UI text goes through the i18n tables in all four languages (en / ja / zh / ko). If you can't translate it, say so in the PR and we'll help.
- Never commit keys, `.env.local`, or anything under `worlds/` (your saves).

## Worlds and content

Worlds are Markdown folders (see `templates/` and [Writing a world](guide/world-authoring.md)). New worlds, translations and fixes to bundled ones are welcome; run `pnpm check:worlds` before you open the pull request. Bundled content is licensed under [CC BY-NC 4.0](CONTENT-LICENSE.md), so only contribute text and art you made yourself or have the right to license that way.

## Contributor License Agreement

Before we can merge your first pull request, you need to sign the [LivingCanvas Individual Contributor License Agreement](.github/CLA.md). It takes one click: the **CLA Assistant** bot comments on your pull request with a link. Sign in with GitHub, agree, and the check turns green. You only sign once, and it covers all your future contributions.

The short version:
- **You keep the copyright** to your contribution.
- You give Ludic Dynamics a broad, permanent licence to use it, including in the hosted service and in commercial products, and to release it under other licences in the future.
- You confirm the work is yours to contribute.

If you are contributing on behalf of your employer, ask them to contact info@worldlines.gg for a corporate agreement first.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Report unacceptable behaviour to info@worldlines.gg.
