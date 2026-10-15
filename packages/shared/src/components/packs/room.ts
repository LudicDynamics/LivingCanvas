import type { ComponentDef } from '../types.js';

/** Room pack — a character's private nook (doc 10 §14.4). */
export const ROOM_PACK: ComponentDef[] = [
  {
    kind: 'diary',
    pack: 'room',
    label: 'Diary',
    purpose: 'A diary or journal: private dated text, optionally continued.',
    match: (fm) => fm.component === 'diary',
    fields: [
      { name: 'date', type: 'string', required: false, desc: 'The entry date.', example: 'the ninth of May' },
      { name: 'mood', type: 'string', required: false, desc: 'A one-word mood.', example: 'tired' },
    ],
    click: 'read',
    channels: { choice: true, status: true, rollDice: true },
    movable: true,
    // doc 10 §16.2: `read+continue` adds the "say something about this" footer.
    secondLayer: 'read+continue',
    example: `---
type: component
component: diary
title: A Diary, Kept Badly
preview: Half the entries are a single line.
date: the ninth of May
mood: tired
---
I keep meaning to write more. Perhaps tomorrow.`,
  },
  {
    kind: 'thread',
    pack: 'room',
    label: 'Conversation',
    purpose: 'One conversation written down, as a two-hander.',
    match: (fm) => fm.component === 'thread',
    fields: [
      { name: 'lines', type: 'array', required: false, desc: 'Who said what, and when.', example: '{who: Watson, text: You are late.}' },
    ],
    click: 'read',
    channels: { choice: true, status: true },
    movable: true,
    secondLayer: 'pairs',
    example: `---
type: component
component: thread
title: A Conversation, Overheard
preview: Neither of them noticed the door was open.
lines:
  - {who: Watson, text: "You are late.", time: "22:10"}
  - {who: Holmes, text: "I am precisely on time. The clock is wrong.", time: "22:11"}
---
The page smells faintly of tobacco.`,
  },
  {
    kind: 'portrait',
    pack: 'room',
    label: 'Portrait',
    purpose: 'A living portrait: a looping silent clip of someone, with a still fallback.',
    // Same predicate shape as the two entries above (room.ts:10 / :35).
    match: (fm) => fm.component === 'portrait',
    fields: [
      { name: 'video', type: 'string', required: false, desc: 'World-relative path to the alpha VP9 clip.', example: 'assets/characters/ryo/ryo.webm' },
      { name: 'poster', type: 'string', required: false, desc: 'World-relative still, shown before/without the clip.', example: 'assets/characters/ryo/base-transparent.png' },
      { name: 'caption', type: 'string', required: false, desc: 'One line pinned on the lower edge of the frame.', example: 'Ryo, mid-thought.' },
    ],
    click: 'look',
    channels: { status: true },
    movable: true,
    secondLayer: 'none',
    example: `---
type: component
component: portrait
title: Ryo at the Window
preview: Barely moving — only the breath.
video: assets/characters/ryo/ryo.webm
poster: assets/characters/ryo/base-transparent.png
caption: Ryo, mid-thought.
---
A figure by the window, caught between two breaths.`,
  },
];
