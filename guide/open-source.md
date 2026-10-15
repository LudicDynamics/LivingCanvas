# Open source at LivingCanvas

This page explains what is in this repository, what is not, why, and how the pieces are licensed. It is a plain-language summary; the license files themselves ([LICENSE](../LICENSE), [CONTENT-LICENSE.md](../CONTENT-LICENSE.md), [TRADEMARKS.md](../TRADEMARKS.md), [NOTICE](../NOTICE)) are what count.

- [What is open](#what-is-open)
- [What stays hosted, and why](#what-stays-hosted-and-why)
- [Running without any Worldlines service](#running-without-any-worldlines-service)
- [How the licenses fit together](#how-the-licenses-fit-together)
- [Forks, mods and your own worlds](#forks-mods-and-your-own-worlds)
- [Names and logos](#names-and-logos)
- [Contributing and the CLA](#contributing-and-the-cla)
- [What is not in this repository](#what-is-not-in-this-repository)

## What is open

Everything you need to run, study, change and extend the game on your own computer:

| Part | Where | License |
|---|---|---|
| The server: world routes, the action service, the engine (clock, triggers, commands, endings, dice), agent lifecycle | `apps/server/` | Apache-2.0 |
| The canvas front end | `apps/web/` | Apache-2.0 |
| The browser runtime (the same server and agents inside a Web Worker, experimental) | `apps/browser-runtime/` | Apache-2.0 |
| The shared world schema, file store, rules and WebSocket protocol | `packages/shared/` | Apache-2.0 |
| The agents' tools | `extensions/` | Apache-2.0 |
| Scaffolding, probes and contract checks | `tools/` | Apache-2.0 |
| The client for signing in to a Worldlines account | `vendor/worldlines-identity-client/` | Apache-2.0 |
| The bundled worlds, the writer and character prompts, the agent skills, models and textures | `templates/`, `presets/`, `skills/`, `assets/models/`, … | CC BY-NC 4.0 |
| The agent runtime | `vendor/pi-rp/` (git submodule) | MIT, © Mario Zechner |

The open-source build **is** the local edition of the game. It is not a cut-down demo: the same code runs the hosted service. Of the hosted worlds, this repository carries eight (Fogwharf, Holmes, The Last Train and its prologue, The Unwritten Door, The Moonlit Pact, Magic Academy, Shiomi Isle), published for you to play and to remix non-commercially; see [Forks, mods and your own worlds](#forks-mods-and-your-own-worlds).

## What stays hosted, and why

The hosted service at [canvas.worldlines.gg](https://canvas.worldlines.gg/?lang=en&src=github) adds a set of account services that are operated by Ludic Dynamics and are not part of this repository:

| Service | What it does | Address in `config/.env.local` |
|---|---|---|
| Accounts | Sign-in (email code, Google) and sessions | `AIRP_ID_BASE` |
| Model gateway | Lets a signed-in player use models and voices paid for with account credits | `AIRP_AI_ACCOUNT_BASE` |
| Storage | Cloud saves and shared or published worlds | `AIRP_STORAGE_BASE` |
| Billing | Credits and purchases | `AIRP_BILLING_BASE` |
| Usage records | Play statistics for signed-in players | `AIRP_CHRONICLE_BASE` |
| Account data | Settings sync, favourites, reviews | `AIRP_DATA_BASE` |

They stay closed because they hold other people's data and money: accounts, payments, keys to paid model providers, and abuse protection. Publishing them would not make your copy of the game more capable — everything that happens *in* a world runs in the open code — but it would make the people who use the hosted service less safe.

The client side of these services (how the game signs in, what it sends and when) is open, in `apps/server/src/sync/`, `apps/web/` and `vendor/worldlines-identity-client/`, so you can check exactly what leaves your machine.

## Running without any Worldlines service

`config/.env.local` decides how this build talks to Worldlines:

- `WORLDLINES_LOGIN=on` (as shipped): the worlds in this repository and your own saves play signed out, with your own key. Signing in is only for what the account adds: worlds other players share through Worldlines, cloud saves, publishing, and account credits for models and voices. Signed out, the game only makes anonymous reads — the lobby's announcements, the public plan and price list of the billing service, and the published community worlds when you open the community board. Usage statistics are only sent while you are signed in, and the **Account → Settings** switch turns them off.
- `WORLDLINES_LOGIN=off`: no sign-in, no account services, nothing reported anywhere; every world is open. Bring your own model key. The only remaining request is the anonymous read of the published community worlds, when you open the community board.

Either way, a key you configure yourself is used directly with your provider and always wins over account credits. See the [configuration reference](configuration.md).

## How the licenses fit together

LivingCanvas uses three layers, because code, creative content and brand names are different kinds of things:

| Layer | License | In practice |
|---|---|---|
| **Code** | [Apache License 2.0](../LICENSE) | Use, change and redistribute it, commercially too. Keep the license and NOTICE, say what you changed. Includes a patent grant. |
| **Content** — worlds, characters, story text, art, animations, voice samples, prompts, skills | [CC BY-NC 4.0](../CONTENT-LICENSE.md) | Share and adapt it for non-commercial purposes, with credit. Commercial use needs permission. The exact paths are listed in CONTENT-LICENSE.md. |
| **Names and logos** | Not licensed — [TRADEMARKS.md](../TRADEMARKS.md) | "LivingCanvas", "Worldlines" and the brand files may be used to refer to the project, not to name your own. |

Third-party parts keep their own licenses: the pi-rp runtime (MIT), the platform audio (CC0 and CC BY 4.0, listed with their authors in [`assets/audio/CREDITS.md`](../assets/audio/CREDITS.md)) and the web fonts (SIL Open Font License, loaded from Google Fonts). See [NOTICE](../NOTICE).

Prompt text that lives inside source files (`apps/`, `packages/`, `extensions/`) is code and falls under Apache-2.0; prompt text in `presets/` and `skills/` is content.

## Forks, mods and your own worlds

- **Your own worlds are yours.** A world you write from scratch, even one started with `tools/scaffold.mjs`, is your work and you choose its license.
- **Remixing the bundled worlds is welcome.** Sequels, side stories, translations, new characters, a world that starts from one of ours: CC BY-NC 4.0 allows all of it. A remix is a derivative of CC BY-NC content: keep the credit (see [CONTENT-LICENSE.md](../CONTENT-LICENSE.md)), keep it non-commercial, or ask us. *Magic Academy* is Mingyue's and is remixable on the same terms, credited to Mingyue.
- **Forking the code** is welcome under Apache-2.0. A public fork must use its own name and logo (see below); replace the files in `apps/web/public/brand/` and the product name in the interface.
- **Running a public server.** You may, under the same terms. Do not present it as the official service, and remember the bundled worlds are non-commercial content.
- **Commercial use of the content** (a paid product built on the bundled worlds or art, for example): write to info@worldlines.gg.

## Names and logos

"LivingCanvas", "Worldlines", "Ludic Dynamics" and their logos are trademarks of Ludic Dynamics. You may say truthfully that your project is a fork of, based on, or compatible with LivingCanvas. Please don't name a fork, app or service "LivingCanvas" or "Worldlines" (or something confusingly close), don't use the logos in your fork, and don't imply that we endorse or operate it. Details: [TRADEMARKS.md](../TRADEMARKS.md).

## Contributing and the CLA

Contributions are welcome — code, worlds, translations, art, bug reports. Before your first pull request is merged you sign the [Individual Contributor License Agreement](../.github/CLA.md) once, with one click when the CLA Assistant bot asks:

- You **keep the copyright** to what you contribute.
- You give Ludic Dynamics a broad, permanent license to use it, including in the hosted service, and to release it under other licenses later.
- You confirm the work is yours to give.

Why a CLA: the project mixes an Apache-2.0 codebase, CC BY-NC content and a hosted service. The agreement lets one maintainer keep all three consistent, change licenses if that is ever needed, and defend the project, without tracking down every past contributor. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the workflow.

## What is not in this repository

Some material that the team uses is deliberately left out of the public copy:

- **Music and sound we may not redistribute.** A few tracks and interface sounds on the hosted service are licensed only for our own use. They are not here; the game plays the CC0 / CC BY track or sound of the same role instead, automatically (`platformAudioFallback` in `packages/shared/src/rules/music.ts`).
- **Some worlds.** The hosted service has a few worlds that are not published here (and the tools and tests that only those worlds use). The eight in `templates/` are the ones we publish.
- **Internal design notes, deployment and operations.** Our working notes, server configuration and the hosted services' code.
- **Asset-production tooling** that depends on third-party services we cannot redistribute access to.
- **The development history.** This repository starts from a clean snapshot; earlier history is not published.

Nothing that the game needs to run, test or be extended is in that list. If something seems missing, please open an issue.
