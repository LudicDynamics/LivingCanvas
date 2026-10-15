---
name: nook-management
description: Use when a character leaves, edits, sorts, gives away, or places something in a private nook; keep README and memory configuration safe, and use move for objects and move_to for presence.
---
# Nook management

Treat `characters/{id}/` as one character's lived-in nook, not as a world layer or a player-controlled scene. Use a stable lowercase kebab-case id and complete paths relative to the world root.

## 1. Read and classify first

Read `characters/{id}/`, its file list, and the relevant world facts before acting. Separate the four immutable root configuration files from lived traces:

```text
characters/{id}/README.md       # nook facade and identity
characters/{id}/identity.md     # identity configuration
characters/{id}/personality.md  # personality configuration
characters/{id}/memory.md       # character-view facts
characters/{id}/diary/entry.md  # lived trace
characters/{id}/keepsakes/key.md
```

A character agent uses only its own `{id}` as its implicit identity. Writer must name the target character explicitly. If a fact or object is not in the brief, an existing file, or the witnessed exchange, report the gap instead of inventing a history.

## 2. Protect configuration; write lived traces

The four root files are never moved or deleted. Do not put a new object, diary entry, letter, or keepsake into `README.md`, `identity.md`, or `personality.md`. Do not casually rewrite `memory.md` while sorting the nook. An explicit configuration-maintenance task may edit one of these files only through the trusted `edit_character_config` action with its declared character, file, content, and replace/append mode; ordinary `write`/`edit` is not a configuration bypass.

The nook is read through its own nook endpoint and shape. It is not a layer: do not call layer initialization for it, put it in the world layer tree, or use it as a `move_to` destination. `player/` is the real player's bag/private space, not an initializer target or a scene.

- an object that was repaired, used, hidden, or prepared for someone;
- a dated diary or unfinished note;
- a worn keepsake with observable marks and a reason it remains;
- a letter with a recipient, promise, or unsent body.

Keep each trace grounded in what the character saw, heard, was told, promised, or did. Preserve uncertainty and conflicting accounts. Never turn Writer-only knowledge or a psychological guess into character memory.

## 3. Choose root projection or an archive

Put a core, recently relevant trace directly under `characters/{id}/` when it should be a candidate for the nook's root card list. Use child directories such as `diary/`, `keepsakes/`, and `letters/` for organization. Child files still belong to the character, but they are not automatically root Nook cards. The public projection should expose direct lived traces while excluding `README.md`, `identity.md`, `personality.md`, and `memory.md`; do not promise a recursive card view or private configuration panel.

The nook is read through its own nook endpoint and shape. It is not a layer: do not call layer initialization for it, put it in the world layer tree, or use it as a `move_to` destination. `player/` is the real player's bag/private space, not an initializer target and not a stronghold.

## 4. Give an object away with move

Move an existing Markdown object file, never a directory or configuration file, to a complete destination file:

```text
move {
  from: "characters/ryo/keepsakes/brass-key.md",
  to:   "player/brass-key.md"
}

move {
  from: "characters/ryo/letter-to-mara.md",
  to:   "world/baker-street/letter-to-mara.md"
}
```

`player/<name>.md` means the item enters the player's bag. `world/<layer>/<name>.md` means it enters a known scene. Do not use bare `player/`, overwrite an existing destination, move a configuration file, or move an object into another character's nook without an explicit supported operation. `move` changes file ownership and records the normal move event; it does not move the character's body.

## 5. Put the character in a scene with move_to

Use `move_to` for presence, with a world scene directory or scene entity as destination:

```text
move_to {
  character: "ryo",
  destination: "world/baker-street"
}
```

A character agent may omit `character` only when its trusted role identifies that character. Writer and UI callers must provide the id. Never use `move` for a character, and never target `characters/ryo/`, `player/...`, or a nook file. `move_to` updates presence and records the normal character-moved event; it does not edit the nook.

## 6. Memory and visibility discipline

Before editing `memory.md`, verify that the character personally witnessed the fact or received it explicitly. Keep names, item names, promises, refusals, and unanswered questions close to their source wording. For a fresh or uncertain experience, prefer a diary or note; update long-term memory only when the task explicitly maintains a confirmed character fact. “I am not sure” is valid memory.

Assume root Markdown may be visible until the runtime configuration gate and projection filter are in place. Never store secrets or hidden prompts in the four configuration files. A tool being available does not prove cross-character permission: stop and report any operation whose actor or target is unclear.

## 7. Verify and report

After every action, read the destination and report exact successful paths, event/action results, and every skipped or failed operation. A missing directory, invalid id/path, existing destination, configuration target, or event failure is partial failure—not permission to retry at another guessed path. Keep the existing event and HTTP refresh channels; do not create a nook state file, a second WebSocket, or browser markup.
