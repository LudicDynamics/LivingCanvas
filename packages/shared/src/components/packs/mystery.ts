import type { ComponentDef } from '../types.js';

/** Mystery pack — deduction (doc 10 §14.4). */
export const MYSTERY_PACK: ComponentDef[] = [
  {
    kind: 'book',
    pack: 'mystery',
    label: 'Book',
    purpose: 'A book, dossier or file; it has pages.',
    match: (fm) => fm.component === 'book',
    fields: [
      { name: 'pages', type: 'array', required: false, desc: 'Page texts; the second layer paginates them.', example: '[Chapter One…]' },
      { name: 'author', type: 'string', required: false, desc: 'Writer of the book.' },
      { name: 'status.data.page', type: 'number', required: false, desc: 'Reading progress.', example: '1' },
    ],
    click: 'read',
    channels: { choice: true, status: true, rollDice: true },
    movable: true,
    secondLayer: 'pages',
    example: `---
type: component
component: book
title: A Casebook of Failures
preview: The spine is cracked; the margins are full of pencil.
author: J. Watson
pages:
  - The first case taught me to write everything down.
  - The second taught me to read it back.
---
Some books are kept for what they say, and some for what they almost said.`,
  },
  {
    kind: 'ledger',
    pack: 'mystery',
    label: 'Ledger',
    purpose: 'An account book; its numbers can be checked against each other.',
    match: (fm) => fm.component === 'ledger',
    fields: [
      { name: 'columns', type: 'array', required: false, desc: 'Column headers.', example: '[Date, Entry, Amount]' },
      { name: 'rows', type: 'array', required: false, desc: 'Rows of string cells.', example: '[[May 3, Coal, 2]]' },
      { name: 'status.data', type: 'object', required: false, desc: 'Conventions: row, total.' },
    ],
    click: 'read',
    channels: { choice: true, status: true, rollDice: true },
    movable: true,
    secondLayer: 'read',
    example: `---
type: component
component: ledger
title: The Household Ledger
preview: One entry is written in a different hand.
columns: [Date, Entry, Amount]
rows:
  - [May 3, Coal, "2"]
  - [May 9, Hansom fare, "1"]
status:
  data:
    total: 3
---
The sums are neat until the ninth of May. After that, the writing changes.`,
  },
  {
    kind: 'photo',
    pack: 'mystery',
    label: 'Photograph',
    purpose: 'A photograph, portrait or sketch: an image plus a caption.',
    match: (fm) => fm.component === 'photo',
    fields: [
      { name: 'image', type: 'string', required: false, desc: 'Asset path under .airpworld/assets/.', example: '.airpworld/assets/gen/adler.png' },
      { name: 'caption', type: 'string', required: false, desc: 'Caption under the image.' },
    ],
    click: 'visual',
    channels: { choice: true, status: true, useItemTarget: true },
    movable: true,
    secondLayer: 'read',
    accepts: { itemKinds: [], itemTags: [], any: true, hint: 'Show this to someone' },
    example: `---
type: component
component: photo
title: A Studio Portrait
preview: Three people, and one of them has been inked over.
image: .airpworld/assets/gen/portrait.png
caption: Adler, taken the winter before she vanished.
---
The photograph is sharp except where the third face has been scratched away.`,
  },
  {
    kind: 'cipher',
    pack: 'mystery',
    label: 'Cipher',
    purpose: 'Ciphertext or a code table; it yields its cleartext once broken.',
    match: (fm) => fm.component === 'cipher',
    fields: [
      { name: 'cleartext', type: 'string', required: false, desc: 'Revealed once decoded.', example: 'The orchard at midnight.' },
      { name: 'accepts', type: 'object', required: false, desc: 'What decodes it.', example: 'itemTags: [cipher-key]' },
      { name: 'status.data.decoded', type: 'boolean', required: false, desc: 'Whether it has been broken.', example: 'false' },
    ],
    click: 'visual',
    channels: { choice: true, status: true, rollDice: true, useItemTarget: true },
    movable: true,
    secondLayer: 'read',
    accepts: { itemKinds: [], itemTags: ['cipher-key', 'code-table'], any: false, hint: 'Try a key or code table' },
    example: `---
type: component
component: cipher
title: A Page of Numbers
preview: Groups of four digits, ruled off in columns.
cleartext: The orchard. Midnight. Come alone.
status:
  data:
    decoded: false
---
The groups repeat in patterns that are almost a word. Almost, but not quite.`,
  },
];
