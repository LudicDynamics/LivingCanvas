---
type: ending
title: The Train Departed
bg: assets/scenes/ending-departed.webp
passages:
  - when: 'player.hp <= 0'
    text: Xia Cheng has to help you off the train. For the twenty-five minutes from the tunnel to Lingkou you lean against the window at seat 18, clutching what you found tonight, unable to get up again.
  - group: su-he
    when: 'has("player/su-he-testimony.md")'
    text: You two got Su He out from among the mail sacks in the baggage car, wrapped in Xia Cheng's padded coat, and she survives. But the call was never made, and what she told you was heard by no one but you.
  - group: su-he
    text: Only after the train arrives does a railway worker find Su He among the mail sacks in the baggage car. She is taken to the hospital and survives, but of that night she remembers only a very bitter cup of tea.
  - group: log
    when: 'has("player/logbook-page.md") || has("world/freight-car/logbook-page.md")'
    text: The logbook page is still in your hands. But it missed tonight's call, and it has a long way to go before it reaches the people who should read it.
  - group: log
    when: 'has("player/torn-corner.md") || has("world/freight-car/torn-corner.md")'
    text: The logbook page went into the stove; all you have is a charred corner. The red signal from twelve years ago stays on Su Changgeng's record alone.
  - group: log
    text: The logbook page is never found again. The red signal from twelve years ago stays on Su Changgeng's record alone.
---

At exactly five, the car shudders, and the last train pulls out of Broken Cloud Tunnel. Twenty-five minutes later it reaches Lingkou, where a bureau car is already waiting on the platform. Zhong Huaili is the first to step off, carrying his suitcase.
