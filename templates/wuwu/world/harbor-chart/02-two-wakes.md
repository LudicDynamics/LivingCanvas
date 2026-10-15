---
type: chalk
title: Find the Other Ship
choice:
  options:
    - id: action-1
      label: "Ask Vera: What do these threads mean?"
    - id: action-2
      label: Investigate More
  allow_free: true
intent: "No forms are filled in here, nothing is submitted. When the player wants to sort things out, Vera chats in her own voice: the evidence the player actually has in their bag, what it shows, and which dice card to go to next. Chat only: no evidence is handed out, no new Check cards are created, no new locations are generated, no ending is declared. Evidence comes only from the investigation dice at each place; Exposed is judged only at world/harbor-chart/05-accuse.md by the engine."
choice_actions:
  action-1:
    kind: character
    character: vera
  action-2:
    kind: enter
    target: world/harbor-chart
---

The scar on the ship, and the time the lighthouse went dark. Put the two together, and there may be another ship in the fog.

If you want to sort things out, ask Vera. Talking costs no tide and needs no dice roll. What actually pins threads to the chart is the investigation dice at each place and the decisive Check on the chart; any thread you missed must be made up at that place's "Long Way Around."
