---
type: readme
name: 221B · Stop the next incident
title: 221B · Stop the next incident
bg: assets/backgrounds/intro.webp
intent: Read and show world/watson-letter.md and fourth-illustration.md. When accepted and taken, move world/blue-brass-cap.md to player/blue-brass-cap.md. Next, guide from London map to the third scene. The truth remains unrevealed. Noon is story pressure; no penalty for real reading time.
choice:
  options:
    - id: action-1
      label: Read the letter and the fourth illustration
    - id: action-2
      label: Take the case and the paint-tube cap
bgVideo: assets/motion/seedance/backgrounds/intro.webm
choice_actions:
  action-1:
    kind: read
    paths:
      - world/watson-letter.md
      - world/fourth-illustration.md
  action-2:
    kind: take
    paths:
      - world/blue-brass-cap.md
map:
  plan:
    picture: assets/maps/baker-street-sitting-room.webp
    pins:
      watson-letter: [0.6, 0.53]
      fourth-illustration: [0.68, 0.58]
      blue-brass-cap: [0.6, 0.63]
      london-map: [0.75, 0.18]
      watson: [0.4, 0.45]
      player: [0.21, 0.77]
---

You are Sherlock Holmes. Watson is standing in your sitting room with his coat still wet, having come straight here.

“My patient Edith is a novelist. Three incidents straight out of her novel have already happened, and the next is due at noon today. Someone is copying her story. She needs your help.”

Two tasks: find out who is copying the novel, and stop today's fourth incident. First read the letter and the fourth picture, take the paint-tube cap, and head out onto the London map. Edith is waiting in the parlor downstairs.
