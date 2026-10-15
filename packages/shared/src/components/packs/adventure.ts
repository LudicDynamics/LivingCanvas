import { containerHandler, lockHandler } from '../core.js';
import type { ComponentDef } from '../types.js';

/** The item tags a keyed mechanism treats as "the right thing" (M-5). */
const KEY_ACCEPTS: { itemKinds: string[]; itemTags: string[] } = {
  itemKinds: ['note'],
  itemTags: ['key', 'key-like', 'crowbar'],
};

/** Adventure pack — mist-harbour / dungeon / exploration (doc 10 §14.4). */
export const ADVENTURE_PACK: ComponentDef[] = [
  {
    kind: 'lock',
    pack: 'adventure',
    label: 'Lock',
    purpose: 'A door, chest or hatch that only opens to the right item.',
    match: (fm) => fm.component === 'lock',
    fields: [
      { name: 'accepts', type: 'object', required: false, desc: 'What this lock responds to as a target.', example: 'itemKinds: [note]' },
      { name: 'status.data.locked', type: 'boolean', required: false, desc: 'The convention the handler reads.', example: 'true' },
      { name: 'status.data.opened_by', type: 'string', required: false, desc: 'Path of the item that opened it.' },
    ],
    click: 'visual',
    channels: { choice: true, status: true, rollDice: true, useItemTarget: true },
    movable: false,
    secondLayer: 'read',
    // M-5: the copper key is `type: note` + `tags: [key]`, so itemKinds is
    // [note] and itemTags carries the semantics. itemKinds matching `component:
    // key` would never match a real key.
    accepts: { ...KEY_ACCEPTS, hint: 'Use a key here' },
    handler: lockHandler,
    example: `---
type: component
component: lock
title: The Cellar Door
preview: A padlock newer than the door it guards.
accepts:
  itemKinds: [note]
  itemTags: [key]
status:
  data:
    locked: true
---
The padlock is bright and oiled. Someone has been keeping this shut.`,
  },
  {
    kind: 'container',
    pack: 'adventure',
    label: 'Container',
    purpose: 'A box, cabinet, drawer or puzzle box; opens onto what it holds.',
    match: (fm) => fm.component === 'container',
    fields: [
      { name: 'accepts', type: 'object', required: false, desc: 'What opens this container.', example: 'itemTags: [key]' },
      { name: 'holds', type: 'array', required: false, desc: 'Paths of what it currently holds.', example: 'world/cellar/watch.md' },
      { name: 'status.data.opened', type: 'boolean', required: false, desc: 'The convention the handler flips.', example: 'false' },
      { name: 'status.data.combo', type: 'string', required: false, desc: 'Combination, for a puzzle box.' },
    ],
    click: 'visual',
    channels: { choice: true, status: true, rollDice: true, useItemTarget: true },
    movable: false,
    secondLayer: 'read',
    accepts: { ...KEY_ACCEPTS, hint: 'Open it with a key' },
    handler: containerHandler,
    example: `---
type: component
component: container
title: The Iron Chest
preview: Deep-riveted, and heavier than it looks.
accepts:
  itemKinds: [note]
  itemTags: [key]
status:
  data:
    opened: false
---
The chest has no handle — only a keyhole, and a lid that has not been raised in years.`,
  },
  {
    kind: 'trap',
    pack: 'adventure',
    label: 'Trap',
    purpose: 'Anything that springs: a tripwire, a needle, a collapsing floor.',
    match: (fm) => fm.component === 'trap',
    fields: [
      { name: 'accepts', type: 'object', required: false, desc: 'What disarms it.', example: 'itemTags: [tool]' },
      { name: 'status.data.armed', type: 'boolean', required: false, desc: 'Whether it is still set.', example: 'true' },
      { name: 'status.data.sprung', type: 'boolean', required: false, desc: 'Whether it has gone off.' },
    ],
    click: 'visual',
    channels: { status: true, rollDice: true, useItemTarget: true },
    movable: false,
    secondLayer: 'read',
    accepts: { itemKinds: [], itemTags: ['tool', 'pry'], any: false, hint: 'Use a tool to disarm it' },
    example: `---
type: component
component: trap
title: A Thin Tripwire
preview: Strung at ankle height, almost invisible in the dust.
status:
  data:
    armed: true
    sprung: false
---
The wire is taut and very thin. Something above it is waiting to fall.`,
  },
  {
    kind: 'mechanism',
    pack: 'adventure',
    label: 'Mechanism',
    purpose: 'A lamp, sluice, gear or lever: a switch with a few positions.',
    match: (fm) => fm.component === 'mechanism',
    fields: [
      { name: 'accepts', type: 'object', required: false, desc: 'What can work it.', example: 'itemTags: [tool]' },
      { name: 'states', type: 'array', required: false, desc: 'The ordered positions.', example: '[off, dim, bright]' },
      { name: 'status.data.position', type: 'string', required: false, desc: 'The current position.', example: 'off' },
    ],
    click: 'visual',
    channels: { choice: true, status: true, rollDice: true, useItemTarget: true },
    movable: false,
    secondLayer: 'read',
    accepts: { itemKinds: [], itemTags: ['tool', 'handle'], any: false, hint: 'Work the mechanism' },
    example: `---
type: component
component: mechanism
title: The Brass Lever
preview: Set in a wall plate worn smooth by hands.
states: [down, up]
status:
  data:
    position: down
---
The lever moves freely in its slot. At the top of the travel, something in the wall takes up the strain.`,
  },
  {
    kind: 'map',
    pack: 'adventure',
    label: 'Map',
    purpose: 'A map or chart; it points the way and changes nothing itself.',
    match: (fm) => fm.component === 'map',
    fields: [
      { name: 'marks', type: 'array', required: false, desc: 'Labelled points on the chart.', example: '{label: Orchard, x: 12, y: 88}' },
      { name: 'region', type: 'string', required: false, desc: 'What area this chart covers.', example: 'baker-street' },
    ],
    click: 'read',
    channels: { choice: true, status: true },
    movable: true,
    secondLayer: 'read',
    example: `---
type: component
component: map
title: A Creased Street Map
preview: Baker Street is circled twice, in different inks.
region: baker-street
marks:
  - {label: Orchard, x: 12, y: 88}
---
The fold lines are soft from use. Someone has walked this route many times.`,
  },
];
