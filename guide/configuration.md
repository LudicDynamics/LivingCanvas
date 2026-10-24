# Configuration reference

LivingCanvas is configured with environment variables, an in-app Settings panel, and two JSON files for models. This page lists what a local install needs. Defaults are the values the code uses when a variable is unset.

- [Two layers of configuration](#two-layers-of-configuration)
- [Worldlines sign-in: on or off](#worldlines-sign-in-on-or-off)
- [Choosing models](#choosing-models)
- [Models and keys](#models-and-keys)
- [Writer tuning](#writer-tuning)
- [Helper models and character ticks](#helper-models-and-character-ticks)
- [Voices and speech-to-text](#voices-and-speech-to-text)
- [Server](#server)
- [Account services](#account-services)
- [Custom providers: `.pi/agent/models.json`](#custom-providers-piagentmodelsjson)
- [Per-world models: `world.json`](#per-world-models-worldjson)

## Two layers of configuration

| File | Tracked | Holds |
|---|---|---|
| [`config/.env.local`](../config/.env.local) | yes | The build mode, public values only: `AIRP_DEPLOY=local`, `WORLDLINES_LOGIN`, `VITE_AIRP_FIRST_RUN`, `AIRP_GUEST_TRIAL` and the Worldlines service addresses. Never put a key here. |
| `.env.local` at the repository root | no (git-ignored) | Your keys and model settings. Start from [`.env.example`](../.env.example). |

The server reads them in this order, and the first value found wins:

1. the process environment (your shell, a launcher);
2. `.env.local` at the repository root;
3. `.env` at the repository root, if you keep one;
4. `config/.env.local`, which only fills in what is still unset.

A file named `.local.env` is no longer read; the server prints a warning if it finds one. The web app reads `config/.env.local` when `pnpm dev` or `pnpm build` starts (as `VITE_*` values), so after changing `WORLDLINES_LOGIN` or `VITE_AIRP_FIRST_RUN` restart `pnpm dev` or rebuild.

**In the app.** **Settings** edits the most common keys (OpenAI, DeepSeek, a custom OpenAI-compatible endpoint, DashScope voices, a local TTS server). It is available on `localhost` only, writes the root `.env.local`, never shows a saved key back, and applies the change without a restart. **Settings → Connection test** sends one tiny request to every configured model, voice and speech service and reports which answer. The in-game **Agents** panel picks the writer and character models for the open save. The last line of the Account dialog (and `GET /api/health`) shows the running mode, for example `local · login on · 0.1.0`.

## Worldlines sign-in: on or off

`WORLDLINES_LOGIN` in `config/.env.local` decides whether this build can use a Worldlines account. The server refuses to start if the value is missing or, with `on`, if any service address is missing or not `https`.

| | `WORLDLINES_LOGIN=on` (default) | `WORLDLINES_LOGIN=off` |
|---|---|---|
| Sign-in | Optional, from the Account dialog | Not available (the sign-in routes answer `login_off`) |
| Models, voices, images, transcription | Your own keys; anything without a key can use the signed-in account's credits | Your own keys only |
| Signed out | Every world in `templates/` and every save on this computer plays, with your own key. The lobby reads public announcements and the billing service's public plan list, and opening the community board reads published worlds and posts (anonymous reads). | Data service, usage reports, guest trial and the account AI route are switched off. Opening the community board still reads the public list of published worlds |
| Usage reports | Only while signed in; **Account → Settings** turns them off | Never |
| Worlds other players share, cloud saves, publishing, rewards | While signed in | Not available |

Your own key always wins over account credits for the same service. Agents never receive the account session (see [Architecture → Security model](architecture.md#security-model)).

**Playing signed out.** With `WORLDLINES_LOGIN=on`, the worlds that ship in `templates/`, your saves and a new world you make all play signed out, with your own key: signing in never stands in front of them and never replaces your key. Only a world another player shared through Worldlines (`published/…`) and the account's own features (cloud saves, publishing, account credits) ask you to sign in. `AIRP_PLAY_WITHOUT_ACCOUNT=1` in `.env.local` removes even that gate while keeping sign-in available. With `WORLDLINES_LOGIN=off` there is no gate: every world is open. (The hosted site, canvas.worldlines.gg, runs its models on the account, so there every world asks for an account; its guest trial is not part of the local edition.)

## Choosing models

The writer and each character run on a pi-rp model, identified by provider and model id. For each save, the model is chosen in this order:

1. the pick in the **Agents** panel for this save (stored in `.airpworld/model-preferences.json`);
2. the world's own `models` hint in `world.json`, when you can use that model;
3. the built-in default: provider `deepseek`, model `deepseek-v4-flash`, thinking `low`.

So with only an OpenAI key, open the **Agents** panel once and pick an OpenAI model. The bundled DeepSeek models are listed from [`config/deepseek-models.example.json`](../config/deepseek-models.example.json), which the server merges into `.pi/agent/models.json` on start without touching your own entries.

Several smaller jobs (the [fast path](architecture.md#the-writer-fast-path), character tick lines, chat summaries, reply suggestions, the workshop helpers) make single OpenAI-compatible calls outside the agents. They use your `DEEPSEEK_API_KEY`, or the signed-in account when there is none. Without either, they are skipped: the writer agent answers every beat and characters act by rules alone.

## Models and keys

| Variable | Default | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI key: OpenAI models for the agents, images and speech-to-text |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Keep it at the official endpoint. A different address found in `.env.local` at startup is moved, together with the key, into the custom OpenAI-compatible slot below |
| `AIRP_CUSTOM_OPENAI_PENDING_BASE_URL`, `AIRP_CUSTOM_OPENAI_PENDING_API_KEY` | — | Any OpenAI-compatible endpoint, normally set from **Settings**. The server reads its `GET /models` list and, once that succeeds, activates it as provider `openai-compatible` (it then writes `AIRP_CUSTOM_OPENAI_BASE_URL`, `_API_KEY` and `_GENERATION` itself) |
| `DEEPSEEK_API_KEY` | — | DeepSeek key: the default agent models and all the helper calls |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Endpoint for the helper calls (fast path, ticks, summaries, suggestions) |
| `OPENROUTER_API_KEY` | — | OpenRouter key, for OpenRouter models and images |
| `AIRP_WRITER_MODEL` | — | Writer model flag at launch (`provider/model`). The per-save choice above is passed after it and takes precedence |
| `AIRP_CHARACTER_MODEL` | `AIRP_WRITER_MODEL` | The same for character agents |
| `AIRP_WRITER_THINKING` | `low` | Writer reasoning level at launch (`off`, `minimal`, `low`, `medium`, `high`); the per-save choice also sets one |
| `AIRP_IMAGE_MODEL` | `openai/gpt-image-1` with an OpenAI key; `openrouter/google/gemini-2.5-flash-image` with an OpenRouter key | Model the writer uses to draw missing scene art |
| `AIRP_IMAGE_BASE_URL` | `OPENAI_BASE_URL` | Images API endpoint |
| `AIRP_IMAGE_QUALITY` | `medium` | `auto`, `low`, `medium` or `high` |
| `AIRP_IMAGE_TIMEOUT_MS` | `150000` | Time limit for one picture |

## Writer tuning

The fast path is described in [Architecture → The writer fast path](architecture.md#the-writer-fast-path); the per-beat policy in [Architecture → The writer agent](architecture.md#the-writer-agent).

| Variable | Default | Meaning |
|---|---|---|
| `AIRP_WRITER_FAST_PATH` | `on` | `off` (or `0` / `false` / `no`): the agent answers every beat. `shadow`: the agent answers, the fast path only logs to `.airpworld/fast-path.log`. `on`: qualifying play beats are answered in one call, the rest fall back to the agent |
| `AIRP_WRITER_FAST_PATH_MODEL` | `deepseek-v4-flash` | Model id for the fast path (at `DEEPSEEK_BASE_URL`, or the account) |
| `AIRP_WRITER_FAST_PATH_MAX_CHARS` | `60000` | Size limit of the packed request; a larger beat goes to the agent |
| `AIRP_WRITER_FAST_PATH_TIMEOUT_MS` | `20000` | Time limit for the fast call |
| `AIRP_WRITER_THINKING_MODE` | `adaptive` | `adaptive`: ordinary beats run with reasoning off, big beats keep the configured level. `fixed`: always the configured level |
| `AIRP_WRITER_BIG_BEAT` | built-in pattern | Case-insensitive regular expression that marks a big beat (leaving, endings, time passing, loops…). An invalid pattern falls back to the default |
| `AIRP_WRITER_COMPACT` | on | `0` turns off folding old beats into a summary |
| `AIRP_WRITER_COMPACT_AT` | `64000` | Compact between beats once the writer's context reaches this many tokens |
| `AIRP_WRITER_COMPACT_KEEP` | `20000` | Recent tokens kept verbatim (at most half of `_AT`) |
| `AIRP_WRITER_EARLY_RELEASE` | on | `0` keeps the player waiting until the writer fully settles, instead of releasing input once the beat has landed |
| `AIRP_WRITER_PAGES` | on | `0` stops including the current page's files in the writer's context |
| `AIRP_WRITER_PAGES_BUDGET` | `8000` | Characters of page text included per beat (`0` = off) |
| `AIRP_WRITER_PAGES_PER_FILE` | `2000` | Characters per file before it is cut (minimum 200) |
| `AIRP_WRITER_MAX_TOOL_CALLS` | `24` | Tool calls per writer beat before it is told to wrap up |
| `AIRP_TURN_TIMEOUT_MS` | `90000` | An agent turn is aborted after this long without progress; text and tool activity reset it. A turn never runs longer than 5 minutes in total |

Per world, `"writer": { "fastPath": false }` in `world.json` keeps the agent; per save, the play settings can do the same. Your own creation worlds (the workshop) always use the agent.

## Helper models and character ticks

All of these are model ids at `DEEPSEEK_BASE_URL` (or on the account), called with `DEEPSEEK_API_KEY`.

| Variable | Default | Meaning |
|---|---|---|
| `AIRP_TICK_MODEL` | `deepseek-v4-flash` | Character ticks: lets a character pick its move and say a line in its own voice. Without a model, ticks run on the world's rules only |
| `AIRP_TICK_MODEL_STUB` | off | `1`: no network; ticks pick the first option and reuse the character's sample lines. For local checks and screenshots |
| `AIRP_CHAT_SUMMARY_MODEL` | `deepseek-v4-flash` | Summarizes a finished character chat for the writer |
| `AIRP_REPLY_SUGGEST_MODEL` | `AIRP_WORKSHOP_SUGGEST_MODEL`, then `deepseek-v4-flash` | Suggested replies for the player |
| `AIRP_WORKSHOP_SUGGEST_MODEL` | `deepseek-v4-flash` | Fill-in help in the world workshop and world intro |

Per save, `characterTick` (`off`, `easy`, `standard`) and `characterVoices` in the play settings turn ticks and their model lines down or off.

## Voices and speech-to-text

| Variable | Default | Meaning |
|---|---|---|
| `DASHSCOPE_API_KEY` | — | Character voices through DashScope Qwen-TTS. Without it, an account or a local TTS server, characters are silent |
| `AIRP_TTS_MODEL` | `qwen3-tts-flash` | DashScope TTS model |
| `AIRP_TTS_BASE_URL` | `https://dashscope-intl.aliyuncs.com/api/v1` | DashScope endpoint (international region) |
| `AIRP_TTS_DEFAULT_VOICE` | `Cherry` | Voice for a character without one |
| `AIRP_TTS_TIMEOUT_MS` | `15000` | Time limit per line |
| `AIRP_LOCAL_TTS` | off | `1` enables voices from your own local TTS server |
| `AIRP_TTS_LOCAL_BASE_URL` | — | Your TTS server: `POST <base>/v1/tts` returns WAV |
| `AIRP_TTS_LOCAL_VOICE` | `setsuna` | Voice id on your server |
| `AIRP_TTS_LOCAL_API_KEY` | — | Optional key for your server |
| `AIRP_TTS_LOCAL_TIMEOUT_MS` | `20000` | Time limit per line |
| `AIRP_STT_MODEL` | `gpt-4o-transcribe` | Player voice input. Uses `OPENAI_API_KEY` and `OPENAI_BASE_URL`, or the account |

## Server

| Variable | Default | Meaning |
|---|---|---|
| `AIRP_HOST` | `127.0.0.1` | Address the server listens on. `0.0.0.0` exposes it to your network with no login in front of it; only on a network you trust |
| `PORT` | `3001` | Server port. The Vite dev server proxies to 3001, so change both together |
| `AIRP_WS_ALLOWED_ORIGINS` | same origin only | Comma-separated extra browser origins (`https://host:port`) allowed to open the WebSocket |
| `AIRP_WS_HEARTBEAT_MS` | `30000` | WebSocket keep-alive interval |
| `AIRP_WORLDS_ROOT` | `<repo>/worlds` | Folder that holds your saves |
| `AIRP_WORLD` | `templates/wuwu` | World opened when the server starts (a template is copied to `worlds/<id>-default` first) |
| `AIRP_PLAY_WITHOUT_ACCOUNT` | off | `1`: never ask for sign-in before entering a world |
| `AIRP_WEB_ORIGIN` | — | Origin of the canvas (for example `http://localhost:5173`). Enables `screenshot_canvas` and screenshot-checked arranging, which render the page headlessly |

Variables used only by the hosted deployment (tenancy, the seat gateway, published-world storage, internal test switches) also exist in the code; a local install does not need any of them.

## Account services

These are read only with `WORLDLINES_LOGIN=on`. `config/.env.local` sets the public addresses; override one only if you run a compatible service yourself.

| Variable | Default (`config/.env.local`) | Service |
|---|---|---|
| `AIRP_ID_BASE` | `https://auth.worldlines.gg` | Sign-in and sessions |
| `AIRP_STORAGE_BASE` | `https://storage.worldlines.gg` | Cloud saves, shared and published worlds |
| `AIRP_AI_ACCOUNT_BASE` | `https://ai.worldlines.gg/v1` | Models, voices, images and transcription billed to the account |
| `AIRP_BILLING_BASE` | `https://billing.worldlines.gg` | Credits and rewards |
| `AIRP_CHRONICLE_BASE` | `https://chronicle.worldlines.gg` | Play counts and usage reports (signed in only) |
| `AIRP_DATA_BASE` | `https://data.worldlines.gg` | Settings sync, favourites, reviews, announcements, the community board |
| `AIRP_AI_ACCOUNT` | on | `0`: never use account credits for models, even while signed in |
| `VITE_AIRP_FIRST_RUN` | `1` | First-run experience: a new visitor confirms a language and plays a short prologue before the lobby (with your own key; without one, talking asks you to set a model up first). `0` turns it off |

With login on, every address must be a valid `https` URL or the server will not start. To switch the services off, set `WORLDLINES_LOGIN=off`: that turns off the data service, usage reports and account credits in one step.

## Custom providers: `.pi/agent/models.json`

The agents use pi-rp's model registry in `.pi/agent/models.json` (git-ignored; the server points pi-rp at this folder, never at your home directory). Add a provider for any endpoint pi-rp can speak to, and name its key by environment variable instead of writing it into the file:

```json
{
  "providers": {
    "my-gateway": {
      "baseUrl": "https://llm.example.com/v1",
      "api": "openai-completions",
      "apiKey": "$OPENROUTER_API_KEY",
      "models": [
        {
          "id": "story-model-large",
          "name": "Story Model Large",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 8192
        }
      ]
    }
  }
}
```

Things to know:

- Agent processes receive only these key variables: `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY` and the custom OpenAI-compatible key. Every other variable whose name looks like a credential is removed before an agent starts, so reference one of these in `apiKey`. For a single OpenAI-compatible endpoint, the custom slot in **Settings** is the simpler route.
- The server adds the bundled DeepSeek models to this file on start and leaves your providers as they are. The provider ids `airp-openai-official` and `openai-compatible` are reserved for the built-in OpenAI and custom slots and are removed from this file.
- When you are signed in, a provider whose key variable is unset is routed through the account instead (in a separate generated copy under `.pi/agent-account/`); your file is not changed.
- New models appear in the **Agents** panel; pick one there for each save.

## Per-world models: `world.json`

A world can suggest models for its agents. Each role takes one to four candidates; the first one the player can use is chosen, unless the player picked a model for this save in the **Agents** panel.

```json
"models": {
  "writer": [{ "model": "deepseek-v4-flash", "thinking": "low" }],
  "character": [
    { "model": "deepseek-v4-pro", "thinking": "off" },
    { "model": "deepseek-v4-flash", "thinking": "off" }
  ]
}
```

`provider` defaults to `deepseek`, and `thinking` (`off`, `low`, `medium`, `high`) to `low`; a bare string is a model id with the defaults. A candidate is skipped when the model is not listed in `.pi/agent/models.json`, or when it is reserved for paid plans and the agent would run on account credits. See [Writing a world](world-authoring.md) for the rest of `world.json`.
