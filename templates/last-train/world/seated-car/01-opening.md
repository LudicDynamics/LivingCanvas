---
type: chalk
title: Car 2 · Hard Seat Car
intent: "Act One (the entry). Su He's seat (17) and the player's seat (18) are
  both here. Beats: Xia Cheng speaks first → the player picks up the notebook →
  rolls to ask the student in seat 20 (the roll is how his account is got; going to
  talk to him is no longer a default option) → gets his account → heads to
  Car 3, the sleeper, or back to the train map (once he has the account, or
  after four beats in this car, both exits lead the options). Student Zhou Zihang
  (20) is NPC card zhou-zihang.md (click him to \"Talk\"), and can only speak of
  what is in witness-account.md: he didn't see the old man's face clearly, and
  only remembers the grey wool coat and greying hair."
status:
  data:
    skipped: no
choice:
  options:
    - id: skip-act-one
      label: I already asked the student in the prologue — straight to the train map
      for: from-prologue
      when: skipped != "yes"
on:
  choice_selected:
    - when: choice.option_id == "skip-act-one"
      run: prologue-carry
      on_error: continue
---

Most of the hard-seat car is asleep, a few people snoring under their coats. On seat 17 sit a canvas bag, a thermos and an open notebook.

Two seats away, Zhou Zihang, a student, sits with his earphones in. He doesn't look like he has slept at all.
