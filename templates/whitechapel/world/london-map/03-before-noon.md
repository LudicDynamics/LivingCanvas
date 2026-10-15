---
type: chalk
title: 'Before Noon'
status:
  data:
    left: 10
    arrived: "no"
    picture: "no"
    hand: "no"
    address: "no"
choice:
  options:
    - id: confront
      label: 'Confront him: lay out that the picture came first and that his hand was at the scene'
      when: 'arrived == "yes" && picture == "yes" && hand == "yes"'
    - id: trap
      label: 'Play along: take the red envelope and have him bring it “to Edith” in the print-shop courtyard at noon — and wait for him there'
      when: 'arrived == "yes" && address == "yes"'
    - id: edith-first
      label: 'Edith first: have Watson take her out the back door of 221B'
      when: 'arrived == "yes"'
    - id: follow-him
      label: 'Act unsuspecting, let him go, and follow him quietly'
      when: 'arrived == "yes"'
intent: 'This card is the pressure before noon. Before Wayne turns up (arrived is no) it only keeps the time; no one sets a quiz, asks for a deduction or has the player fill anything in. When the player has established enough, the engine has Wayne himself stop Holmes (command/wayne-turns-up.yaml): play him polite, stubborn, red envelope under his arm, refusing to leave, set on handing the proof of the fourth picture to Edith in person; Watson urges Holmes to decide now, and Edith wants to face him herself. Which moves are open depends on what the player actually found. The decisions on this card are carried out by the engine (command/confront-wayne.yaml, set-trap.yaml, edith-first.yaml, follow-wayne.yaml); the writer never announces an ending in prose and never decides for the player.'
on:
  choice_selected:
    - run: confront-wayne
      when: 'choice.option_id == "confront"'
    - run: set-trap
      when: 'choice.option_id == "trap"'
    - run: edith-first
      when: 'choice.option_id == "edith-first"'
    - run: follow-wayne
      when: 'choice.option_id == "follow-him"'
---

Two hours to noon. A search that goes badly eats into the morning; if noon comes first, the fourth picture comes true.

No guessing, no written deduction: search the scene, the morgue, the print shop and the sitting room with your own hands. Once you have established enough, the one turning the novel into real events will not be able to sit still and will come to you. What you hold then decides what you can do.
