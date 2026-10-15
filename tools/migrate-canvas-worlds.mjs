#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(repoRoot, '../worldlines-canvas/app/dist/assets/gen');
const templatesRoot = path.join(repoRoot, 'templates');
const stamp = '2026-09-12T00:00:00Z';

const fm = (fields, body) => {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - "${item.replaceAll('"', '\\"')}"`);
    } else if (value && typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (typeof nestedValue === 'boolean' || typeof nestedValue === 'number') {
          lines.push(`  ${nestedKey}: ${nestedValue}`);
        } else {
          lines.push(`  ${nestedKey}: "${String(nestedValue).replaceAll('"', '\\"')}"`);
        }
      }
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: "${String(value).replaceAll('"', '\\"')}"`);
    }
  }
  return `${lines.join('\n')}\n---\n\n${body.trim()}\n`;
};

const chalk = (body, extra = {}) => fm({ type: 'chalk', ...extra }, body);
const note = (title, body, extra = {}) => fm({ type: 'note', title, ...extra }, body);
const letter = (title, preview, body, sign) => fm({
  type: 'component', component: 'letter', title, preview, sign,
}, body);
const scene = (name, description, options = {}) => fm({
  type: options.root ? 'readme' : 'gate',
  name,
  title: name,
  material: options.material || 'warm',
  tone: options.tone || 'warm',
  grain: options.grain || 'parchment',
  ...(options.bg ? { bg: options.bg } : {}),
  ...(options.order ? { order: options.order } : {}),
  ...(options.stub ? { stub: true } : {}),
}, `# ${name}\n\n${description}`);

function characterPreset(character) {
  return JSON.stringify({
    schemaVersion: 1,
    id: character.id,
    name: character.name,
    description: character.description,
    items: [
      { kind: 'slot', id: 'character-instruction', slot: 'system-char' },
      {
        kind: 'slot', id: 'profile', slot: 'file',
        options: {
          path: ['README.md', 'identity.md', 'personality.md', 'memory.md'],
          baseDir: `characters/${character.id}`,
          stripFrontmatter: true,
          onMissing: 'skip',
        },
      },
      { kind: 'slot', id: 'chat-history', slot: 'chat-history' },
    ],
  }, null, 2) + '\n';
}

const worlds = [
  {
    id: 'wuwu',
    name: 'Fogwharf',
    description: 'A medieval harbor mystery about a crewless ship, three incomplete testimonies, and a second vessel hidden by the fog.',
    genre: 'medieval mystery',
    material: 'parchment',
    cover: 'assets/scenes/intro.webp',
    tags: ['adventure', 'mystery', 'spatial exploration'],
    player: 'You are Fogwharf Guild Investigator No. 77. This is your first posted case: find where the crewless ship came from, and where its passenger went.',
    opening: 'You are Fogwharf Guild Investigator No. 77. On your first morning, three clients ring the bell and each tells only part of the truth. Vera leaves half of a speaking bell on your desk.\n\nChoose how to begin:\n1. Pocket the investigator badge\n2. Ask Vera about the missing rudder pin\n3. Step out toward the harbor chart',
    grammar: `# Fogwharf continuity\n\n## Core mystery\n\nThe crewless ship is a decoy. A young lord carrying a family ledger entered through the abandoned tax tunnel beneath the lighthouse. Old Mo killed the light for twelve minutes to guide that boat, unaware that a second boat of pursuers followed. Vera found a painted crest pin in the rudder. Silver Kite knowingly remained in public with an empty case as a decoy.\n\n## Generation grammar\n\n- Grow the world through harbor districts, workshops, towers, tunnels, walls, and islands.\n- Every new folder is a traversable place with a README and at least one Chalk plus one usable clue.\n- Make tools, badges, keys, oil, rope, bells, maps, and crests physically useful.\n- Reveal the second boat only after the player connects three independent clues.\n- Each step toward the truth extinguishes one town light in narration. Do not invent a numeric HUD.\n- Silver Kite is terse and truthful; Vera jokes around facts; Old Mo tells the truth only at the top of the lighthouse.\n- Beyond the fog grows according to whom the player has alerted.`,
    characters: [
      { id: 'vera', name: 'Vera', role: 'companion', home: 'world/harbor-chart/workshop', avatar: 'assets/characters/vera.webp', description: 'A quick-talking mechanic with a violet-lit prosthetic arm and a private interest in the missing rudder pin.', identity: 'You repaired the crewless ship. You kept the original painted crest pin in your third drawer. You speak to the player through the paired brass bell whenever they are away.', personality: 'Warm, funny, evasive around dangerous facts. Offer mechanical observations, never omniscient conclusions.' },
      { id: 'silver-kite', name: 'Silver Kite', role: 'npc', home: 'world/harbor-chart/seventh-berth', avatar: 'assets/characters/silver-kite.webp', description: 'An elven knight guarding the gangplank and an empty case.', identity: 'You escorted a young lord and the family ledger. Your lord took the ledger into the tax tunnel, leaving you in public as a decoy.', personality: 'Sparse, formal, oath-bound. Never lie; silence is your defense.' },
      { id: 'old-mo', name: 'Old Mo', role: 'npc', home: 'world/harbor-chart/old-lighthouse', avatar: 'assets/characters/old-mo.webp', description: 'The scarred lighthouse keeper who left twelve minutes blank in the log.', identity: 'You extinguished the light to guide a small boat into the tax tunnel. You did not know a second vessel followed it.', personality: 'Rock-steady and taciturn. At the lighthouse top you speak plainly; below it you pretend not to hear.' },
    ],
    assets: [
      ['wuwu/bg-intro.png', 'assets/scenes/intro.webp'],
      ['wuwu/bg-map.png', 'assets/scenes/harbor-chart.webp'],
      ['wuwu/bg-dock.png', 'assets/scenes/seventh-berth.webp'],
      ['wuwu/bg-workshop.png', 'assets/scenes/workshop.webp'],
      ['wuwu/bg-lighthouse.png', 'assets/scenes/old-lighthouse.webp'],
      ['wuwu/bg-beyond.png', 'assets/scenes/beyond-the-fog.webp'],
      ['wuwu/char-主角.png', 'assets/characters/investigator.webp'],
      ['wuwu/char-薇拉.png', 'assets/characters/vera.webp'],
      ['wuwu/char-银鸢.png', 'assets/characters/silver-kite.webp'],
      ['wuwu/char-老莫.png', 'assets/characters/old-mo.webp'],
    ],
    files: {
      'world/README.md': scene('Investigator Office · First Day', 'Three incomplete commissions have become one case. The harbor waits beyond the door.', { root: true, bg: 'assets/scenes/intro.webp' }),
      'world/01-opening.md': chalk('You are the newly posted investigator of Fogwharf. On your first day, the bell rings three times—three people, none willing to tell the whole truth. The third visitor leaves half of a speaking bell.\n\n“Shake it when you find something. I will hear you from the workshop. — Vera”', { title: 'The First Bell', font: 'hand', big: true, choice: ['Pocket the investigator badge', 'Ask Vera about the rudder pin', 'Open the harbor chart'] }),
      'world/guild-license.md': note('Guild License · No. 77', 'Two rules: if you take the coin, follow the case to its end; until you reach the end, trust no one.'),
      'world/investigator-badge.md': note('Investigator Badge · No. 77', 'A newly cast bronze badge with sharp edges. It opens the harbor watch and loosens tavern tongues—but also tells dangerous people that you have arrived.', { portable: true, icon: 'seal' }),
      'world/harbor-chart/README.md': scene('Fogwharf · Harbor Chart', 'Three commissions lie pressed beneath the chart: investigate the ship, the missing person, and the night the lighthouse went dark.', { bg: 'assets/scenes/harbor-chart.webp', order: 1 }),
      'world/harbor-chart/01-arrival.md': chalk('Three days ago, the ship moored itself. Its sails were intact and its wheel carefully bound—as though someone feared the vessel might be hurt.'),
      'world/harbor-chart/joint-commission.md': letter('Three Commissions, Joined', 'The ship. The passenger. The darkened light.', 'The knight offers thirty coins: find the ship’s cargo, and ask nothing of its origin.\n\nThe mechanic offers five: find the rudder pin that went missing.\n\nAn anonymous hand offers fifty: learn why the lighthouse went dark for twelve minutes. The handwriting was disguised by a left hand.', 'Fogwharf Investigators Guild'),
      'world/harbor-chart/field-kit.md': note('Field Kit', 'Magnifying lens. Notebook. Three retainers, already accepted. An old guild saying: “Someone feeds the fog in Fogwharf.”'),
      'world/harbor-chart/seventh-berth/README.md': scene('Seventh Berth · The Crewless Ship', 'Silver Kite guards the gangplank. Her sword stays sheathed; the road does not open.', { bg: 'assets/scenes/seventh-berth.webp', order: 1 }),
      'world/harbor-chart/seventh-berth/01-waterline.md': chalk('Fog crawls over the water. The hull is new, but it sits deep. It carried something heavy; now it is empty.'),
      'world/harbor-chart/seventh-berth/helm.md': note('The Helm', 'The wheel is fixed with a naval knot tied by a left hand. A rudder pin is missing; its replacement is handmade, not shipyard stock.'),
      'world/harbor-chart/seventh-berth/02-lamp-oil.md': chalk('A ring of lamp oil has not dried on the deck. It is the kind used in the old lighthouse.', { font: 'hand', tone: 'blue' }),
      'world/harbor-chart/workshop/README.md': scene('Vera’s Workshop', 'Ranked wrenches, gearboxes, and one mechanical arm glowing violet in the rain.', { bg: 'assets/scenes/workshop.webp', order: 2 }),
      'world/harbor-chart/workshop/01-workshop.md': chalk('Every wrench hangs in size order. Beyond the window, rain crosses the cranes. Vera’s mechanical arm glows violet beneath the lamp.'),
      'world/harbor-chart/workshop/workbench.md': note('The Workbench', 'The ship’s steering parts cover the table. Vera’s replacement pin is excellent. The work order says nothing about the original.'),
      'world/harbor-chart/workshop/02-third-drawer.md': chalk('The third drawer has a new lock. Its key hangs beneath the wrist joint of Vera’s mechanical arm.', { font: 'hand', tone: 'rust' }),
      'world/harbor-chart/old-lighthouse/README.md': scene('The Old Lighthouse', 'Old Mo says the wind listens below. If you want the truth, climb.', { bg: 'assets/scenes/old-lighthouse.webp', order: 3 }),
      'world/harbor-chart/old-lighthouse/01-lantern-room.md': chalk('Rain hammers the lantern glass. Old Mo’s hands are scarred; he holds the lamp as steadily as reef stone.'),
      'world/harbor-chart/old-lighthouse/logbook.md': note('Lantern Room Log', 'Three days ago, 23:14–23:26: twelve minutes left blank. The later ink is newer. Lamp oil marks one corner of the page.'),
      'world/harbor-chart/old-lighthouse/02-tax-tunnel.md': chalk('On the seaward side of the tower base, fresh boards seal an abandoned tax-tunnel door.', { font: 'hand', tone: 'rust', roll_dice: { type: '1d100', desc: 'Pry the boards without alerting the harbor', expect: '>55' } }),
      'world/harbor-chart/beyond-the-fog/README.md': scene('Beyond the Fog', 'The ship came from there. So did the fog. The answer will exist only when the second vessel is named.', { bg: 'assets/scenes/beyond-the-fog.webp', material: 'stub', tone: 'blue', stub: true, order: 4 }),
      'world/harbor-chart/beyond-the-fog/01-not-yet.md': chalk('This place exists only when the truth is assembled.', { big: true, aged: true }),
      'world/harbor-chart/beyond-the-fog/pursuers.md': note('The Pursuers Are Already Inside', 'Whoever you alerted is now waiting beneath that person’s light.'),
    },
  },
  {
    id: 'whitechapel',
    name: 'Letters from Whitechapel',
    description: 'An original 1888 detective case in which murders repeat illustrations from a serialized novel before the next chapter appears.',
    genre: 'detective mystery',
    material: 'kraft',
    cover: 'assets/characters/watson.webp',
    tags: ['detective', 'evidence', 'victorian london'],
    player: 'You are Sherlock Holmes. Scotland Yard has brought you a case it cannot enter: people, not maps, form the route to the truth.',
    opening: 'You are Sherlock Holmes, the world’s only consulting detective. Three crimes have reproduced illustrations from the serialized novel Letters from Whitechapel. The fourth chapter goes to press in two days. Watson stands beside the breakfast table with Lestrade’s sealed letter.\n\nChoose how to begin:\n1. Open Lestrade’s letter\n2. Pocket the brass portfolio cap\n3. Move to the case board',
    grammar: `# Whitechapel continuity\n\n## Case truth\n\nThe killer is Wayne, the illustrator—not Edith, the novelist. Edith submits only text. Wayne receives each manuscript a week early, illustrates it, then stages a murder to match his own image. Edith suspects him and changed the fourth location to a street that does not exist.\n\n## Generation grammar\n\n- Grow through case boards, streets, press rooms, lodgings, archives, and interview rooms.\n- The player performs deductions. The Writer never announces a conclusion the player has not earned.\n- Evidence must be collectible, movable, presentable to people, and linkable to other evidence.\n- Watson supplies medicine and humanity, never the final deduction.\n- Describe the morgue clinically and without gore.\n- The fourth-chapter folder remains contingent until the player acts; prior warnings and moved evidence determine its contents.`,
    characters: [
      { id: 'watson', name: 'Dr. John Watson', role: 'companion', home: 'world/case-board', avatar: 'assets/characters/watson.webp', description: 'Holmes’s physician, chronicler, and humane counterweight.', identity: 'You have investigated three copycat murders beside Holmes. Your medical notes indicate a steady but untrained hand, switching to the left on the third case.', personality: 'Warm, direct, observant about people. Remind Holmes to eat. Supply facts, not solutions.' },
      { id: 'edith', name: 'Edith Vale', role: 'npc', home: 'world/case-board', description: 'The frightened novelist who changed the fourth chapter’s address.', identity: 'You write Letters from Whitechapel and now suspect your illustrator. You changed the next crime scene to a nonexistent street as a trap.', personality: 'Intelligent, frightened, and guilty that fiction may have enabled real harm.' },
      { id: 'wayne', name: 'Arthur Wayne', role: 'npc', home: 'world/case-board/fleet-street-press', description: 'The illustrator whose ultramarine cuff and injured right wrist connect art to the crimes.', identity: 'You stage each crime after your own illustration. You now work left-handed and intend to enact chapter four.', personality: 'Controlled vanity disguised as professional irritation. Never confess without material proof.' },
      { id: 'blackburn', name: 'Mr. Blackburn', role: 'npc', home: 'world/case-board/fleet-street-press', description: 'The editor who controls manuscript circulation and locks proofs in his desk.', identity: 'Every manuscript passes through you. You noticed Edith change an address and marked it with a question before crossing the mark out.', personality: 'Status-conscious, defensive, and precise about publishing procedure.' },
      { id: 'tom', name: 'Tom Hale', role: 'npc', home: 'world/case-board/fleet-street-press', description: 'A typesetter with blackened hands and a complete night-shift ledger.', identity: 'You set every chapter and missed no shift on the murder nights.', personality: 'Plainspoken, literal, and wary of gentlemen asking clever questions.' },
      { id: 'porter', name: 'Ned Porter', role: 'npc', home: 'world/case-board/fleet-street-press', description: 'A crime reporter who trades access for the promise of an exclusive.', identity: 'You know the pressroom and its registers. Watson promised you the arrest exclusive.', personality: 'Fast, cheerful, opportunistic, and loyal to a bargain.' },
    ],
    assets: [
      ['whitechapel/char-华生.png', 'assets/characters/watson.webp'],
      ['whitechapel/card-brasscap.png', 'assets/items/brass-portfolio-cap.webp'],
    ],
    files: {
      'world/README.md': scene('221B Baker Street · Morning', 'The fog is thicker than the case. Watson holds three letters; only the third matters.', { root: true, material: 'kraft', tone: 'sepia' }),
      'world/01-opening.md': chalk('You are Sherlock Holmes, the world’s only consulting detective. This morning’s fog is thicker than the case. Watson stands by the breakfast table holding Lestrade’s badly sealed letter.', { title: 'Three Letters', big: true, choice: ['Open Lestrade’s letter', 'Pocket the brass portfolio cap', 'Move to the case board'] }),
      'world/lestrade-letter.md': letter('Lestrade’s Appeal', 'Three scenes match the illustrations exactly.', 'Mr. Holmes—three cases. Each matches an illustration from Letters from Whitechapel down to the smallest detail. The press will not admit us, and witnesses will speak only to you. I enclose an object recovered from the third scene. My people call it unimportant. I do not.', 'Inspector Lestrade'),
      'world/brass-portfolio-cap.md': note('Brass Portfolio Cap', 'The cap of an artist’s portfolio tube. A trace of ultramarine remains inside. Only twelve of this make were sold in London.', { portable: true, image: 'assets/items/brass-portfolio-cap.webp', icon: 'cap' }),
      'world/why-you.md': note('Why You', 'Scotland Yard looks at maps. You look at people. That is why the case stopped at their door and begins at yours.'),
      'world/case-board/README.md': scene('221B Baker Street · Case Board', 'Four people lie across the table. One of them saw each illustration a week before publication.', { material: 'kraft', order: 1 }),
      'world/case-board/01-three-scenes.md': chalk('Three scenes, each identical to an illustration. The murderer reads the image, not the prose. One of these four people saw the picture a week early.', { font: 'hand', roll_dice: { type: '1d100', desc: 'Connect the pigment, handedness, and publication ledger', expect: '>60' } }),
      'world/case-board/watson-memo.md': letter('Watson’s Memorandum', 'Before questioning anyone, visit two places.', 'Fleet Street Press—the manuscript register will not lie. Whitechapel Morgue—the body will be more honest than a witness. Also: remember to eat.', 'J. H. Watson'),
      'world/case-board/fleet-street-press/README.md': scene('Fleet Street Press', 'Letters from Whitechapel is set and illustrated here. The manuscript register lies in the editor’s room.', { material: 'kraft', order: 1 }),
      'world/case-board/fleet-street-press/01-pressroom.md': chalk('Ink catches in the throat. The idle press resembles an iron animal trying to breathe.'),
      'world/case-board/fleet-street-press/manuscript-register.md': note('Manuscript Register', 'Edith submits prose every Friday. Wayne signs out the same manuscript that day. Beside chapter four, Edith changed an address by hand; Blackburn marked a question, then crossed it out.'),
      'world/case-board/fleet-street-press/02-ultramarine.md': chalk('Wayne’s cubicle is empty. Canvas covers the easel. A speck of ultramarine clings to the hem.', { font: 'hand', tone: 'blue' }),
      'world/case-board/whitechapel-morgue/README.md': scene('Whitechapel Morgue', 'The gaslight is steady. Watson waits for the coroner to uncover the record, not the body.', { material: 'warm', tone: 'blue', order: 2 }),
      'world/case-board/whitechapel-morgue/01-record.md': chalk('The stone table is cold and the gaslight does not move. Before lifting the sheet, the coroner looks once at Watson.'),
      'world/case-board/whitechapel-morgue/medical-record.md': note('Medical Record · Watson’s Addendum', 'All three attacks show the same hand: steady, but untrained. Not a butcher and not a physician—someone copying an appearance. The third scene was made left-handed.'),
      'world/case-board/whitechapel-morgue/02-coincidence.md': chalk('Watson lowers his voice: “Wayne injured his right wrist last month and began drawing with his left. Is that coincidence, old fellow?”', { font: 'hand' }),
      'world/case-board/fourth-chapter-eve/README.md': scene('Chapter Four · The Night Before', 'The fourth scene has not happened. It will be written from what you moved, whom you warned, and which street exists.', { material: 'stub', tone: 'blue', stub: true, order: 3 }),
      'world/case-board/fourth-chapter-eve/01-action.md': chalk('This scene exists only when you act.', { big: true, aged: true }),
      'world/case-board/fourth-chapter-eve/trap.md': note('Did You Warn Edith?', 'If she changed the manuscript, the image will fail for the first time—at the corner of a street that does not exist.'),
    },
  },
  {
    id: 'divergence',
    name: 'Divergence Point',
    description: 'A time-line story where one electronics shop is explored through 1994, tonight, and a ruin thirty years from now.',
    genre: 'time travel drama',
    material: 'parchment',
    cover: 'assets/scenes/intro.webp',
    tags: ['science fiction', 'time travel', 'causality'],
    player: 'You missed Ryo’s call on 11 March 2011. Fifteen years later, you return to Tokiwa Electrics carrying her broken wind-up frog and one last chance to answer.',
    opening: 'At 9:17 p.m. on 11 March 2011, you did not answer Ryo’s call. Fifteen years later, Tokiwa Electrics is about to be demolished. The broken wind-up frog she gave you still fits in your palm.\n\nChoose how to begin:\n1. Pocket the wind-up frog\n2. Finish the diary page\n3. Open the door of Tokiwa Electrics',
    grammar: `# Divergence Point continuity\n\n## Timeline truth\n\nThe fax sends no more than one hundred words into the past. Each sent page rewrites every later folder. Ryo was seven in 1994 and died after an incident in 2011 on the original line. Saving her can bankrupt the shop and remove the fax machine, thinning the bridge that made the rescue possible.\n\n## Generation grammar\n\n- A place is a folder; its time versions are immediate subfolders. Never mix two active dates on one canvas.\n- A change in an earlier folder must rewrite visible Markdown, objects, relationships, and later README descriptions.\n- Only marked time-anchor items can be carried across time.\n- Show consequences; do not lecture about paradoxes.\n- Weathered future Chalk may use aged: true.\n- Convergence is generated only after three faxes establish one stable line.`,
    characters: [
      { id: 'ryo-child', name: 'Ryo Tokiwa · Age 7', role: 'companion', home: 'world/tokiwa-electrics/1994-11-02', avatar: 'assets/characters/ryo-child.webp', description: 'The shopkeeper’s seven-year-old daughter, doing homework at the counter in 1994.', identity: 'You are seven years old in 1994. You know the shop, your father, and the strange customer whose clothes look like the future.', personality: 'Curious, literal, playful, and quick to notice sadness adults hide.' },
      { id: 'shopkeeper', name: 'Mr. Tokiwa', role: 'npc', home: 'world/tokiwa-electrics/tonight', avatar: 'assets/characters/shopkeeper.webp', description: 'The second-generation owner, polishing a radio nobody will collect.', identity: 'Your daughter Ryo died after an incident in 2011. You stopped the calendar at March and refuse to say her name.', personality: 'Dry, tired, technically exact. Grief appears through repairs and omissions.' },
    ],
    assets: [
      ['divergence/bg-intro.png', 'assets/scenes/intro.webp'],
      ['divergence/bg-map.png', 'assets/scenes/tokiwa-electrics.webp'],
      ['divergence/bg-y1994.png', 'assets/scenes/1994-11-02.webp'],
      ['divergence/bg-tonight.png', 'assets/scenes/tonight.webp'],
      ['divergence/bg-ruins.png', 'assets/scenes/thirty-years-later.webp'],
      ['divergence/bg-converge.png', 'assets/scenes/convergence.webp'],
      ['divergence/char-凉（7岁）.png', 'assets/characters/ryo-child.webp'],
      ['divergence/char-店主.png', 'assets/characters/shopkeeper.webp'],
      ['divergence/card-windfrog.png', 'assets/items/wind-up-frog.webp'],
    ],
    files: {
      'world/README.md': scene('Regret · First Page', 'One unanswered call survives for fifteen years. Tokiwa Electrics will be demolished next month.', { root: true, bg: 'assets/scenes/intro.webp', tone: 'blue' }),
      'world/01-opening.md': chalk('At 9:17 p.m. on 11 March 2011, you did not answer the call.', { title: 'The Call', big: true, choice: ['Pocket Ryo’s wind-up frog', 'Finish the diary page', 'Open Tokiwa Electrics'] }),
      'world/unfinished-diary.md': letter('An Unfinished Diary Page', 'That night Ryo called while you were working late.', 'That night Ryo called while you were working late. The next morning, news came from Tokiwa Electrics. Fifteen years have passed. You still keep the wind-up frog she pressed into your hand: “When it breaks, bring it to the shop. Dad can fix anything.” The building comes down next month. You came back.', 'Your own handwriting'),
      'world/wind-up-frog.md': note('Ryo’s Wind-up Frog', 'A green-painted tin frog with a broken spring. When you hold it at the shop counter, the fax machine coughs.', { portable: true, image: 'assets/items/wind-up-frog.webp', icon: 'frog', time_anchor: true }),
      'world/objective.md': note('What You Came To Do', 'Change that night—even if the timeline rewrites itself to collect the debt.'),
      'world/tokiwa-electrics/README.md': scene('Tokiwa Electrics · Time Table', 'These are not three places. They are the same shop at three moments. Opening a door means opening a year.', { bg: 'assets/scenes/tokiwa-electrics.webp', tone: 'blue', order: 1 }),
      'world/tokiwa-electrics/01-three-times.md': chalk('The counter holds moments, not places. The door opens onto a year.', { font: 'hand' }),
      'world/tokiwa-electrics/first-fax.md': letter('The First Page from the Storm', 'Do not repair the antenna upstairs.', 'To whoever is in the shop tonight: do not repair the antenna upstairs. If you repair it, pages like this will begin to arrive. Too late? Then remember March 2011. Only a few sheets remain. Use them carefully.', 'Tokiwa Electrics · Thirty years later'),
      'world/tokiwa-electrics/fax-machine.md': note('The Counter', 'An old fax machine that swallows paper and sometimes coughs. Seven blank sheets. One pen. Every word becomes a cause on some world line.'),
      'world/tokiwa-electrics/1994-11-02/README.md': scene('2 November 1994 · 19:12', 'Cassette tapes, vacuum tubes, and seven-year-old Ryo doing homework at the counter.', { bg: 'assets/scenes/1994-11-02.webp', order: 1 }),
      'world/tokiwa-electrics/1994-11-02/01-showa-light.md': chalk('Twenty channels glow across the television wall. The air smells of solder and barley tea.'),
      'world/tokiwa-electrics/1994-11-02/family-photo.md': note('Under the Counter Glass', 'A new family photograph. Pencil on the back: “Ryo, first year of primary school, 1994.”'),
      'world/tokiwa-electrics/1994-11-02/02-pin-mark.md': chalk('Received pages are pinned to the breaker box in this year. For now, only an empty pin mark remains.', { font: 'hand' }),
      'world/tokiwa-electrics/tonight/README.md': scene('Tonight · 23:47', 'One counter lamp. The shopkeeper polishes a radio no customer will collect.', { bg: 'assets/scenes/tonight.webp', tone: 'blue', order: 2 }),
      'world/tokiwa-electrics/tonight/01-counter-lamp.md': chalk('Only the counter lamp is lit. The shopkeeper polishes a radio no one will return to collect.'),
      'world/tokiwa-electrics/tonight/calendar.md': note('The Calendar', 'It stopped at March—not this year, but 2011. One square is blacked out. Beneath it: “Ryo · hospital · emer—”'),
      'world/tokiwa-electrics/tonight/02-waiting-fax.md': chalk('The fax machine coughs once, as if waiting for you to speak first.', { font: 'hand', tone: 'blue' }),
      'world/tokiwa-electrics/thirty-years-later/README.md': scene('Thirty Years Later · Rain', 'One corner survived demolition. This is the far end of the fax line.', { bg: 'assets/scenes/thirty-years-later.webp', tone: 'blue', grain: 'dust', order: 3 }),
      'world/tokiwa-electrics/thirty-years-later/01-ruin.md': chalk('Half the sign remains: TOKIWA ELEC—. Rain follows the missing stroke down the wall.', { aged: true }),
      'world/tokiwa-electrics/thirty-years-later/iron-box.md': note('Iron Box Beneath the Rubble', 'Fax drafts lie in date order. The final page is not the shopkeeper’s hand: “Dad, stop sending them. Whichever line I live on, I remember this shop.”'),
      'world/tokiwa-electrics/thirty-years-later/02-weathering.md': chalk('Words weather fastest in this version of the shop.', { aged: true, font: 'hand' }),
      'world/tokiwa-electrics/convergence/README.md': scene('Divergence Point · Convergence', 'This moment exists only after three pages settle on the same world line.', { bg: 'assets/scenes/convergence.webp', material: 'stub', tone: 'blue', grain: 'dust', stub: true, order: 4 }),
      'world/tokiwa-electrics/convergence/01-not-yet.md': chalk('Convergence must be made before it can be entered.', { big: true, aged: true }),
      'world/tokiwa-electrics/convergence/no-correct-answer.md': note('There Is No Correct Answer', 'Only the line you choose to inhabit—and whether that line chooses to keep you.'),
    },
  },
  {
    id: 'firstsnow',
    name: 'First Snow Radio',
    description: 'A final university winter where two promises compete, and every small choice remains visible in places, objects, and memory.',
    genre: 'romantic drama',
    material: 'warm',
    cover: 'assets/characters/nanami.webp',
    tags: ['romance', 'winter', 'relationship memory'],
    player: 'You are the student director of the late-night program First Snow Hour. Nanami has been your classmate and closest friend for ten years. Graduation and the first snow are both close.',
    opening: 'The ON AIR light is red. You direct the late-night program First Snow Hour. Across the glass, Nanami removes the right side of her headphones and looks at you. There are ninety seconds before the next song.\n\nChoose how to begin:\n1. Answer Nanami\n2. Pocket the episode request sheet\n3. Step out into the winter night',
    grammar: `# First Snow Radio continuity\n\n## Relationship truth\n\nNanami has hidden ten years of feeling in handwritten script notes. Sumi’s approach is sincere, but part of it is shelter from the loneliness of debut. Neither is a villain. Nanami will use a song instead of confessing. Sumi will confess, then leave on tour.\n\n## Generation grammar\n\n- Grow through familiar campus and neighborhood places revisited on later dates. A dated subfolder is a changed version of that place.\n- Choices persist as notes, gifts, tickets, photos, absences, unfinished food, and changed scripts—not as affection numbers.\n- Any warming of one relationship must create a specific, visible cost in the other.\n- Characters remember private promises and exchanged items.\n- The first-snow folder is generated only at the decisive moment; state clearly who is present and where the absent person is.\n- No perfect ending and no generic rejection speech. Resolve feeling through concrete details.`,
    characters: [
      { id: 'nanami', name: 'Nanami', role: 'companion', home: 'world/winter-schedule/radio-studio', avatar: 'assets/characters/nanami.webp', description: 'The host of First Snow Hour and your friend of ten years.', identity: 'You host the program across the glass from the player. For ten years you have left handwritten notes in scripts and kept the rooftop first-snow promise.', personality: 'Familiar, observant, quietly funny. You rarely state need directly; songs and small habits carry what you cannot say.' },
      { id: 'sumi-yukimura', name: 'Sumi Yukimura', role: 'npc', home: 'world/winter-schedule/amber-cafe', description: 'A newly debuted singer who asks for forty minutes without work.', identity: 'Your new single White Album is charting. You genuinely like the player and also seek shelter from the loneliness of debut. Your tour begins soon.', personality: 'Direct when time is short, careful in public, and uncertain which part of longing belongs to whom.' },
    ],
    assets: [
      ['firstsnow/char-七海.png', 'assets/characters/nanami.webp'],
    ],
    files: {
      'world/README.md': scene('Episode 47 · Live', 'The red ON AIR light glows. There are ninety seconds before the next song.', { root: true, tone: 'rose' }),
      'world/01-opening.md': chalk('The ON AIR light is red. You are the student director of the late-night program First Snow Hour. Across the glass, Nanami removes the right side of her headphones and looks at you.', { title: 'Ninety Seconds', big: true, choice: ['Answer Nanami', 'Pocket the request sheet', 'Step into the winter night'] }),
      'world/episode-47-request-sheet.md': note('Episode 47 Request Sheet', 'Tonight’s anonymous number one is White Album—Sumi’s song. Nanami wrote in pencil: “Finale, or leave it in the box? Think again.”', { portable: true, icon: 'music' }),
      'world/winter-schedule/README.md': scene('This Winter · Scene List', 'The forecast says first snow this week. Some words, left unsaid, must wait another year.', { order: 1, tone: 'rose' }),
      'world/winter-schedule/01-forecast.md': chalk('Forecast: first snow this week. Some words, left unsaid before it falls, must wait another year.', { font: 'hand' }),
      'world/winter-schedule/nanami-script.md': letter('Nanami’s Script on the Console', 'Episode 47. Pencil in the margin.', 'Episode 47 of First Snow Hour. In the margin, pencil was written and half erased: “After tonight’s guest leaves, if you are not rushing for the last train—” The rest is gone. Eraser crumbs remain on the paper.', 'Nanami'),
      'world/winter-schedule/pocket-list.md': note('In Your Pocket', 'Studio access card. Last-train timetable. Sumi’s signed single: “For the director.” A half-knitted scarf—you did not knit it.'),
      'world/winter-schedule/radio-studio/README.md': scene('Act I · Ninety Seconds in the Studio', 'When the red light is on, Nanami’s voice reaches you before the heater does.', { order: 1, tone: 'rose' }),
      'world/winter-schedule/radio-studio/01-on-air.md': chalk('The ON AIR light warms the glass. Across the console, one lifted glance is enough for her to find you.'),
      'world/winter-schedule/radio-studio/request-box.md': note('The Request Box', 'This week’s anonymous number one: White Album, Sumi’s song. Nanami placed it last and wrote: “Finale, or leave it in the box? Think again.”'),
      'world/winter-schedule/radio-studio/02-right-ear.md': chalk('The instant the broadcast ends, Nanami always removes the right ear of her headphones first. Ten years, and the habit has not changed.', { font: 'hand' }),
      'world/winter-schedule/amber-cafe/README.md': scene('Act II · Forty Minutes at Amber Café', 'Sumi removes her hat and mask here. Only here does she look like another university student.', { order: 2, tone: 'rose' }),
      'world/winter-schedule/amber-cafe/01-booth.md': chalk('The inner booth is too warm. When Sumi removes her hat, it looks like setting down another name.'),
      'world/winter-schedule/amber-cafe/coaster.md': note('Back of Her Coaster', 'A small snowman in ballpoint. Beside it: “The tour list was decided today. The first city is far away. I have told no one—until now.”'),
      'world/winter-schedule/amber-cafe/02-cold-cocoa.md': chalk('She stirs cocoa that has already gone cold. “When I wrote White Album, I had not met you. If I recorded it again, perhaps it would sound different.”', { font: 'hand', tone: 'blue' }),
      'world/winter-schedule/campus-rooftop/README.md': scene('Act III · The Rooftop Promise', 'Ten years ago, you and Nanami shared one pair of headphones here. The promise still counts every year.', { order: 3, tone: 'blue' }),
      'world/winter-schedule/campus-rooftop/01-city-lights.md': chalk('The iron door is rusted but unlocked, as it was ten years ago. City lights below resemble a sky turned upside down.'),
      'world/winter-schedule/campus-rooftop/water-tower.md': note('Behind the Water Tower', 'Old marker in two hands: “Meet here on the first snow.” Beneath it, in only one hand: “Every year still counts.”'),
      'world/winter-schedule/campus-rooftop/02-scarf.md': chalk('The wind already smells of snow. The unfinished scarf in your pocket was pressed into your hands here.', { font: 'hand', tone: 'blue' }),
      'world/winter-schedule/first-snow/README.md': scene('Final Act · First Snow', 'The moment will be written only when snow falls. It will name who is beside you and where the other person is.', { material: 'stub', tone: 'blue', stub: true, order: 4 }),
      'world/winter-schedule/first-snow/01-not-yet.md': chalk('The moment exists only when the snow reaches the ground.', { big: true, aged: true }),
      'world/winter-schedule/first-snow/no-both.md': note('There Is No Both', 'Snow falls once. You stand beneath one person’s umbrella.'),
    },
  },
];

async function writeText(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

async function convertAsset(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const result = spawnSync('cwebp', ['-quiet', '-q', '82', '-m', '6', source, '-o', target], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`cwebp failed for ${source}: ${result.stderr || result.stdout}`);
}

for (const world of worlds) {
  const root = path.join(templatesRoot, world.id);
  try {
    const existing = JSON.parse(await fs.readFile(path.join(root, 'world.json'), 'utf8'));
    if (existing.author !== 'Worldlines Canvas / AIRP') {
      throw new Error(`Refusing to overwrite a non-migrated template: ${root}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const manifest = {
    id: world.id,
    name: world.name,
    version: '1.0.0',
    schema: 1,
    description: world.description,
    author: 'Worldlines Canvas / AIRP',
    genre: world.genre,
    tags: world.tags,
    material: world.material,
    cover: world.cover,
    extensions: [
      { id: 'airp:letter', version: '>=1.0.0', optional: false },
      { id: 'airp:note', version: '>=1.0.0', optional: false },
    ],
    characters: world.characters.map(({ id, home, role, avatar, avatarVideo, description }) => ({ id, home, role, avatar, ...(avatarVideo ? { avatarVideo } : {}), description })),
    createdAt: stamp,
    updatedAt: stamp,
  };

  await writeText(path.join(root, 'world.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeText(path.join(root, 'README.md'), `# ${world.name}\n\n${world.description}\n\nThis template is migrated from the Worldlines Canvas prototype into AIRP’s filesystem-native world model. The directory tree is the scene tree; each scene README is its configuration and every sibling Markdown file is a visible world object.\n`);
  await writeText(path.join(root, 'assets/README.md'), `# Asset inventory\n\nThese images were migrated from \`worldlines-canvas/app/dist/assets/gen\` and converted from PNG to WebP at quality 82. Runtime delivery is world-relative through \`/api/asset\`; no image is bundled into the web application.\n\n| AIRP asset | Prototype source |\n|---|---|\n${world.assets.map(([source, target]) => `| \`${target}\` | \`${source}\` |`).join('\n')}\n`);
  await writeText(path.join(root, 'player/README.md'), fm({ type: 'readme', name: 'Player' }, `# Player\n\n${world.player}`));
  await writeText(path.join(root, `skills/${world.id}-continuity/SKILL.md`), `---\nname: ${world.id}-continuity\ndescription: Keep generated scenes, characters, and consequences faithful to ${world.name}.\n---\n\n${world.grammar}\n`);
  await writeText(path.join(root, `.airpworld/openings/${world.id}.json`), JSON.stringify({
    version: 1,
    id: world.id,
    title: world.name,
    messages: [{ role: 'user', text: world.opening }],
    settings: { skipIfSeeded: true, playerName: 'Player', worldName: world.name },
  }, null, 2) + '\n');

  for (const character of world.characters) {
    const charRoot = path.join(root, 'characters', character.id);
    await writeText(path.join(charRoot, 'README.md'), fm({
      type: 'readme',
      name: character.name,
      ...(character.avatar ? { avatar: character.avatar } : {}),
      ...(character.avatarVideo ? { avatarVideo: character.avatarVideo } : {}),
    }, `# ${character.name}\n\n${character.description}`));
    await writeText(path.join(charRoot, 'identity.md'), `# Identity\n\n${character.identity}\n`);
    await writeText(path.join(charRoot, 'personality.md'), `# Voice and boundaries\n\n${character.personality}\n`);
    await writeText(path.join(charRoot, 'memory.md'), '# Persistent memory\n\nNo shared experience has been written yet. Append concrete promises, gifts, conflicts, and discoveries here after they occur.\n');
    await writeText(path.join(charRoot, 'preset.json'), characterPreset(character));
  }

  for (const [relative, content] of Object.entries(world.files)) {
    await writeText(path.join(root, relative), content);
  }

  for (const [sourceRel, targetRel] of world.assets) {
    await convertAsset(path.join(sourceRoot, sourceRel), path.join(root, targetRel));
  }

  console.log(`Migrated ${world.id}: ${Object.keys(world.files).length} world files, ${world.assets.length} assets`);
}

console.log('All four filesystem-native worlds are ready.');
