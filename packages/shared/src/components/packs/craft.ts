import type { ComponentDef } from '../types.js';

/** Craft pack — handwork / academy / slice of life (doc 10 §14.4). */
export const CRAFT_PACK: ComponentDef[] = [
  {
    kind: 'instrument',
    pack: 'craft',
    label: 'Instrument',
    purpose: 'An instrument, such as a piano or a lute; play it, tune it, open it.',
    match: (fm) => fm.component === 'instrument',
    fields: [
      { name: 'status.data.lid', type: 'string', required: false, desc: 'Lid position, e.g. open or closed.', example: 'closed' },
      { name: 'status.data.tune', type: 'string', required: false, desc: 'Tuning state.', example: 'unknown' },
      { name: 'accepts', type: 'object', required: false, desc: 'What can work it.', example: 'itemTags: [oil]' },
    ],
    click: 'visual',
    channels: { choice: true, status: true, rollDice: true, useItemTarget: true },
    movable: false,
    secondLayer: 'read',
    accepts: { itemKinds: [], itemTags: ['oil', 'tuner'], any: false, hint: 'Oil or tune the instrument' },
    example: `---
type: component
component: instrument
title: The Grand Piano
preview: The lid is down, and a fine dust lies on it.
status:
  data:
    lid: closed
    tune: unknown
---
The piano has not been played in a long time, but the stool has been moved recently.`,
  },
  {
    kind: 'board',
    pack: 'craft',
    label: 'Board',
    purpose: 'A board or sandbox game; its second layer renders the grid in place.',
    match: (fm) => fm.component === 'board',
    fields: [
      { name: 'grid', type: 'object', required: false, desc: 'Grid size for the second layer.', example: '{cols: 19, rows: 19}' },
      { name: 'status.data.position', type: 'string', required: false, desc: 'Compact position string.', example: 'b-d4,b-q16' },
      { name: 'accepts', type: 'object', required: false, desc: 'What places on it.', example: 'itemTags: [stone]' },
    ],
    click: 'visual',
    channels: { choice: true, status: true, rollDice: true, useItemTarget: true },
    movable: false,
    secondLayer: 'board',
    accepts: { itemKinds: [], itemTags: ['stone', 'piece'], any: false, hint: 'Place a stone' },
    example: `---
type: component
component: board
title: The Unfinished Game
preview: Black has not moved in a very long time.
grid:
  cols: 19
  rows: 19
status:
  data:
    position: b-d4,b-q16,w-d16
    turn: black
accepts:
  itemKinds: []
  itemTags: [stone]
---
Two bowls, one nearly empty. The last stone is set down slightly off the line.`,
  },
];
