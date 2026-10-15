---
type: readme
title: You
states:
  - id: hp
    label: Wounds
    type: number
    initial: 10
    range: [0, 10]
    shown_as:
      - { min: 8, text: Unhurt }
      - { min: 4, text: Hurt }
      - { min: 1, text: Badly hurt }
      - { max: 0, text: Barely alive }
sheet:
  skills:
    - id: spot_hidden
      label: Spot Hidden
      value: 60
    - id: library_use
      label: Library Use
      value: 60
    - id: psychology
      label: Psychology
      value: 60
    - id: stealth
      label: Stealth
      value: 60
    - id: science
      label: Science (Chemistry)
      value: 75
    - id: disguise
      label: Disguise
      value: 65
    - id: fighting
      label: Fighting (Boxing)
      value: 55
    - id: listen
      label: Listen
      value: 55
    - id: fast_talk
      label: Fast Talk
      value: 50
    - id: locksmith
      label: Locksmith
      value: 45
    - id: firearms
      label: Firearms
      value: 40
---

You are Sherlock Holmes. There are no monsters in this case — only wet railings, heavy type cases, and a man who does not want to be seen through.
