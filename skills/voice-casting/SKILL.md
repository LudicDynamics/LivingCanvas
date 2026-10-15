---
name: voice-casting
description: Use when giving a character a voice — writing or changing the `voice:` line in a character's README, or picking a voice for a new character. Covers choosing by effect from the palette, why a wrong name fails silently, and what the same-world collision rule forbids.
---

# Casting a voice

A character's voice is one line in the frontmatter of `characters/<id>/README.md` — the same README
that names them:

```yaml
voice: wise-elder
```

It is not prose and it is not a name you invent. It is a **lookup key** into a fixed palette, and the
palette is the whole vocabulary the speech engine knows. Get the key wrong and the character does not
refuse to speak — she speaks in the house default instead, and nothing in the fiction, and nothing the
player sees, says so.

## Write the effect, never the engine's name

| Write | Not |
|---|---|
| `wise-elder` | `Eldric Sage` |
| `hoarse-weathered` | `Vincent` |
| `news-anchor` | `Neil` |

**Why.** The engine's own names are unmemorable and easy to half-remember: `Eldric Sage` is one voice
whose name contains a space, and `Eldric` / `Sage` are not voices at all. When a name is not in the
palette the page still plays, on the default voice: the character you wrote as an old man speaks with
the house narrator's throat, for every page of the world. This already shipped here — a character
declared a name that looked right and was silent or wrong from the first line, and nobody noticed
until someone listened to it.

An **effect** name does not depend on remembering a spelling. You pick it from a list you can read,
not from a name you have to recall exactly.

## Choosing

Read the palette (`references/voice-palette.md`), then answer one question: **what should this person
sound like?**

1. **Default: pick the voice whose description is the closest match to the person.** Age, warmth,
   pace, and who they are speaking to are the axis — not gender alone, not "importance". An old,
   steady, authoritative figure → `wise-elder`; a bright, teasing one → `playful-teasing`; a voice
   worn down by weather → `hoarse-weathered`.
2. **Exception — the sound you want is genuinely not there.** Do not approximate with a near-synonym
   and move on; see "Adding a voice to the palette" below.
3. **Then check the world.** If someone else in it already speaks in that voice, go back to step 1.

**One more rule: two characters in the same world must not share a voice.** Cross-world reuse is
fine — the same actor, or a house style — but if two people in one world speak alike, the player
loses track of who is talking the moment they cannot see the portrait. Check what the others already
use before you settle on yours, and note that **a character who declares no voice speaks in the
default** — so two silent declarations are a collision, not a way to stay out of this rule.

## What a wrong cast costs

- **A name not in the palette** → the line still plays, on the default voice. The character you wrote
  as an old man speaks as the house narrator. `pnpm check:voices` reports it, but that gate runs only
  when someone runs it (it is not part of `pnpm build`), so the realistic way to learn is a person
  listening. Write it right the first time.
- **A same-world collision** → two characters become one voice; every scene where both are present
  turns into an argument the player cannot follow by ear.
- **A gender mismatch** → the voice does not match the portrait the player is looking at, and the two
  arrive together on every line.

## Not yours to decide

- **Language.** One voice speaks every language; the world's `locale` picks which. Do not look for a
  "Japanese voice" — there is no second palette, and a voice is not cast per language.
- **Line breaks.** How many lines a reply has is decided by how the character writes; a line is one
  page and one spoken clip. A cast is not a reason to write shorter sentences.
- **The description column is a hint, not a setting.** `references/voice-palette.md` describes each
  sound so you can choose; the description is not something to copy into a README.

## Adding a voice to the palette

The palette only holds voices that were **observed to produce audio**. It is not a list of names that
look plausible — admitting unverified names is exactly what lets a typo pass as valid and go silent.
If the sound you want genuinely is not there, that is a change to
`packages/shared/src/rules/voices.ts` with a real synthesis to prove it, not a new name in a README.
The procedure is in `docs/tts/07`.

## Before you call it done

Run `pnpm check:voices`. It reads every character README under `templates/`, fails on any `voice` the
palette cannot resolve, and fails when two characters in one world would speak in the same voice
(including two characters that both leave the line out). It walks the shipped templates only — a
character you add inside a player's world is not in its walk, so check that one by hand, and remember
that an omitted `voice:` is not neutral: it means the default.
