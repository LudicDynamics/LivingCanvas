import type { ComponentDef } from '../types.js';

/** Chronicle pack — timeline science fiction (doc 10 §14.4). */
export const CHRONICLE_PACK: ComponentDef[] = [
  {
    kind: 'clock',
    pack: 'chronicle',
    label: 'Clock',
    purpose: 'A clock or timer: the visible carrier of world time.',
    match: (fm) => fm.component === 'clock',
    fields: [
      { name: 'status.data.time', type: 'string', required: false, desc: 'The time it reads.', example: '03:41' },
      { name: 'status.data.running', type: 'boolean', required: false, desc: 'Whether it is running.', example: 'true' },
    ],
    click: 'visual',
    channels: { choice: true, status: true, rollDice: true, useItemTarget: true },
    movable: false,
    secondLayer: 'read',
    accepts: { itemKinds: [], itemTags: ['key', 'winder'], any: false, hint: 'Wind or set the clock' },
    example: `---
type: component
component: clock
title: The Station Clock
preview: Eleven minutes slow, and always has been.
status:
  data:
    time: "03:41"
    running: true
---
The second hand stutters at the same place every minute, as if remembering something.`,
  },
  {
    kind: 'tape',
    pack: 'chronicle',
    label: 'Recording',
    purpose: 'A recording: playing it back is reading, not time travel.',
    match: (fm) => fm.component === 'tape',
    fields: [
      { name: 'duration', type: 'number', required: false, desc: 'Length in seconds.', example: '120' },
      { name: 'status.data.position', type: 'string', required: false, desc: 'Playback position.', example: '00:00' },
    ],
    click: 'read',
    channels: { choice: true, status: true },
    movable: true,
    secondLayer: 'read',
    example: `---
type: component
component: tape
title: A Reel of Tape
preview: Labelled only with a date, in a hand you half recognise.
duration: 120
status:
  data:
    position: "00:00"
---
The tape is wound almost to the end. Someone listened to nearly all of it.`,
  },
  {
    kind: 'anchor',
    pack: 'chronicle',
    label: 'Anchor',
    purpose: 'A time anchor: an object kept across timelines.',
    match: (fm) => fm.component === 'anchor',
    fields: [
      { name: 'accepts', type: 'object', required: false, desc: 'What it anchors onto.', example: 'itemTags: [door]' },
      { name: 'status.data.linked_to', type: 'string', required: false, desc: 'The timeline layer it holds.', example: 'world/timeline-a' },
    ],
    click: 'visual',
    channels: { choice: true, status: true, useItemTarget: true },
    movable: true,
    secondLayer: 'read',
    accepts: { itemKinds: [], itemTags: ['door', 'gate', 'interface'], any: false, hint: 'Anchor it here' },
    example: `---
type: component
component: anchor
title: A Brass Token
preview: Cold to the touch, even in a warm room.
status:
  data:
    linked_to: world/timeline-a
---
The token is heavier than its size explains. It does not warm to your hand.`,
  },
];
