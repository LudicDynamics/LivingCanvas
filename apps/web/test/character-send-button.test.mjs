// Character reply boxes get the writer's send pill
// One `SendButton` is shared by WriterBar,
// CharacterModal, CharacterDock and NpcDialogue; each host wires it to the SAME
// submit function Enter already calls, so busy / empty / IME guards stay single.
// Run: node --test apps/web/test/character-send-button.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const read = rel => fs.readFileSync(path.join(webRoot, rel), 'utf8');

const sendButton = read('src/components/chrome/SendButton.tsx');
const writerBar = read('src/components/chrome/WriterBar.tsx');
const modal = read('src/components/overlay/CharacterModal.tsx');
const dock = read('src/components/sidebar/CharacterDock.tsx');
const npc = read('src/components/sidebar/NpcDialogue.tsx');
const css = read('src/index.css');
const messages = JSON.parse(read('src/lib/messages.json'));

/** The `<SendButton … />` element in a host's source. */
function sendElement(source) {
  const match = source.match(/<SendButton\b[\s\S]*?(?:\/>|<\/SendButton>)/);
  assert.ok(match, 'host renders a SendButton');
  return match[0];
}

/** The element of the text input whose Enter path sends. */
function enterHandler(source) {
  const match = source.match(/onKeyDown=\{\(?(\w+)\)? => \{\s*if \(guardImeKey\(\1\)\) return;\s*if \(\1\.key === 'Enter'\) \{ \1\.preventDefault\(\); (\w+)\(\); \}/);
  assert.ok(match, 'Enter path: IME guard first, then preventDefault + submit');
  return match[2];
}

test('the writer and every character box share one send component and one class', () => {
  assert.match(sendButton, /className=\{className \? `writer-bar__send \$\{className\}` : 'writer-bar__send'\}/);
  assert.match(sendButton, /type="button"/);
  assert.match(sendButton, /aria-label=\{label\}/);
  // Pressing it may take focus: the blur commits an open IME composition before
  // the click sends, so mouse down must NOT be cancelled.
  assert.doesNotMatch(sendButton, /onMouseDown|onPointerDown/);
  assert.match(writerBar, /<SendButton\s+tutorialTarget="writer-send"/);
  assert.doesNotMatch(writerBar, /className="writer-bar__send"/, 'no second copy of the writer pill');
  for (const host of [modal, dock, npc]) {
    assert.match(host, /import \{ SendButton \} from '\.\.\/chrome\/SendButton\.js';/);
    assert.match(sendElement(host), /className="character-send"/);
  }
});

test('the button calls the same submit as Enter, after the IME guard', () => {
  assert.equal(enterHandler(modal), 'handleSend');
  assert.match(sendElement(modal), /onSend=\{handleSend\}/);
  assert.equal(enterHandler(dock), 'send');
  assert.match(sendElement(dock), /onSend=\{send\}/);
  assert.equal(enterHandler(npc), 'send');
  // The NPC's bubble lines say through the same send: the button calls it with no override.
  assert.match(sendElement(npc), /onSend=\{\(\) => send\(\)\}/);
});

test('disabled while a reply is in flight or the draft is empty', () => {
  assert.match(sendElement(modal), /disabled=\{busy \|\| inputText\.trim\(\) === ''\}/);
  assert.match(sendElement(dock), /disabled=\{busy \|\| draft\.trim\(\) === ''\}/);
  assert.match(sendElement(npc), /disabled=\{busy \|\| draft\.trim\(\) === ''\}/);
  // The submit functions keep their own guards, so a stale click is still a no-op.
  assert.match(modal, /if \(!msg \|\| busyRef\.current\) return;/);
  assert.match(dock, /if \(text === '' \|\| dialogue\.phase !== 'idle'\) return;/);
  assert.match(npc, /if \(!target \|\| text === '' \|\| busy\) return;/);
});

test('localized accessible names in every UI language', () => {
  assert.match(sendElement(modal), /label=\{t\('Send to \{name\}', \{ name: characterId \}\)\}/);
  assert.match(sendElement(dock), /label=\{t\('Send to \{name\}', \{ name: displayName \}\)\}/);
  assert.match(sendElement(npc), /label=\{t\('Send to \{name\}', \{ name: target\.name \}\)\}/);
  assert.match(sendElement(writerBar), /label=\{t\('Send'\)\}/);
  assert.match(modal, /aria-label=\{t\('Message to \{name\}', \{ name: characterId \}\)\}/);
  for (const key of ['Send', 'Send to {name}', 'Message to {name}']) {
    for (const locale of ['zh-CN', 'ja', 'ko']) {
      assert.ok(messages[key]?.[locale], `${key} has ${locale}`);
    }
    if (key.includes('{name}')) {
      for (const locale of ['zh-CN', 'ja', 'ko']) assert.match(messages[key][locale], /\{name\}/);
    }
  }
});

test('the forced tutorial speak step still highlights the row that now holds the button', () => {
  const row = dock.match(/<div className="character-dock__input-row" data-guide-target="speak" data-tutorial="speak">[\s\S]*?\n {10}<\/div>/);
  assert.ok(row, 'speak target is the dock input row');
  assert.match(row[0], /<SendButton/);
  const tutorial = fs.readFileSync(path.join(webRoot, 'src/lib/forced-tutorial.ts'), 'utf8');
  assert.match(tutorial, /case 'speak': return '\[data-tutorial="speak"\], \[data-guide-target="speak"\]';/);
  // The caption does not tell the player to press Enter.
  assert.doesNotMatch(tutorial.match(/case 'speak': return 'Your first line[^']*'/)[0], /Enter/);
});

test('touch target: 44px on coarse pointers, in the input row', () => {
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.character-send \{\s*min-width: 44px;\s*min-height: 44px;/);
});

test('render: label, disabled state and glyph', async () => {
  const require = createRequire(pathToFileURL(path.join(webRoot, 'test/x.mjs')));
  const esbuild = require(path.join(repoRoot, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js'));
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const cacheDir = path.join(webRoot, 'node_modules/.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cacheDir, 'airp-send-'));
  const out = await esbuild.build({
    entryPoints: [path.join(webRoot, 'src/components/chrome/SendButton.tsx')],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    platform: 'node',
    logLevel: 'error',
  });
  const bundle = path.join(dir, 'send-button.mjs');
  fs.writeFileSync(bundle, out.outputFiles[0].text, 'utf-8');
  const { SendButton } = await import(pathToFileURL(bundle).href);
  const idle = renderToStaticMarkup(React.createElement(SendButton, { label: 'Nanamiに送る', className: 'character-send', onSend() {} }));
  assert.match(idle, /^<button type="button" class="writer-bar__send character-send" aria-label="Nanamiに送る" title="Nanamiに送る">↑<\/button>$/);
  const locked = renderToStaticMarkup(React.createElement(SendButton, { label: 'Send', disabled: true, tutorialTarget: 'writer-send', onSend() {} }, '⏎'));
  assert.match(locked, /class="writer-bar__send"/);
  assert.match(locked, /data-tutorial="writer-send"/);
  assert.match(locked, /disabled=""/);
  assert.match(locked, />⏎<\/button>$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

//: on the NPC card (罗德昌, 归乡) the writer's round ✎ sat on top
// of the ↑ pill, so players saw "only Enter works, and the button is a pencil".
test('the writer FAB never covers an NPC or companion send pill', () => {
  const app = fs.readFileSync(path.join(webRoot, 'src/App.tsx'), 'utf8');
  // The stage on screen: the dock or an NPC talk, unless it yielded to the drawer / the writer.
  assert.match(app, /const stageOnScreen = \(dockExpanded \|\| npcTalking\) && !stageYields;/);
  assert.match(app, /clearCompanion=\{stageOnScreen && !nookChar\}/,
    'the FAB steps aside while an NPC dialogue holds the corner too');
  const dockCss = read('src/components/sidebar/character-dock.css');
  const narrow = dockCss.slice(dockCss.indexOf('@media (max-width: 1100px)'));
  assert.match(narrow, /\.character-dock__input-row \{\s*padding-right: var\(--character-dock-fab-room, 64px\);/,
    'narrow screens: the reply row stops short of the FAB corner');
  assert.match(dockCss, /\.character-dock__input-row \.writer-bar__send \{\s*background: var\(--ux-color-cream\);\s*color: var\(--ux-color-ink\);/,
    'the pill is cream on the dark stage, not ink on ink');
  // NPC: disabled while empty or while the NPC is still answering.
  assert.match(sendElement(npc), /disabled=\{busy \|\| draft\.trim\(\) === ''\}/);
  assert.equal(enterHandler(npc), 'send');
});
