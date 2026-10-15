import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const nook = await readFile(new URL('../src/components/nook/NookView.tsx', import.meta.url), 'utf8');
const portrait = await readFile(new URL('../src/components/nook/NookPortrait.tsx', import.meta.url), 'utf8');
const composer = await readFile(new URL('../src/components/nook/NookNoteComposer.tsx', import.meta.url), 'utf8');
const media = await readFile(new URL('../src/components/media/CharacterMedia.tsx', import.meta.url), 'utf8');
const camera = await readFile(new URL('../src/lib/camera.ts', import.meta.url), 'utf8');

test('Nook forwards the layer action surface and observes every current card', () => {
  for (const callback of ['onItemDropOnTarget', 'onDropItemToScene', 'onOpenCharacterModal', 'onEntityAction']) {
    assert.match(nook, new RegExp(`${callback}=`));
  }
  assert.match(nook, /onDiceRolled=\{onDiceRolled\}/);
  assert.match(nook, /querySelectorAll<HTMLElement>\('\.object\[data-path\]'\)/);
  assert.match(nook, /observer\.observe\(el\)/);
});

test('Nook refreshes on file and entity world events and projects card positions', () => {
  assert.match(nook, /eventType === 'file_changed'/);
  for (const type of ['entity_created', 'entity_edited', 'entity_deleted', 'entity_moved']) {
    assert.match(nook, new RegExp(type));
  }
  assert.match(nook, /eventType === 'card_position'/);
  assert.match(nook, /item\.path === msg\.path/);
});

test('App keeps failed writer input, has one Stop, and focuses Enter', () => {
  assert.match(app, /if \(!result\.accepted\)/);
  assert.match(app, /writerPendingRef/);
  assert.equal((app.match(/className="writer-stop-control"/g) ?? []).length, 1);
  assert.match(app, /requestWriterStop\(\)/);
  assert.match(app, /window\.setTimeout\(\(\) => writerRef\.current\?\.focus\(\), 0\)/);
  assert.match(app, /setCharacters\(\[\]\)/);
  assert.match(app, /retryWriterPrompt\(\)/);
  assert.match(app, /data-writer-retry/);
  assert.match(app, /parseDiceFrameResult/);
  assert.match(app, /dice result could not be understood/);
});
test('Nook note composer posts the top-level gateway path and locks transport', () => {
  assert.match(composer, /fetch\('\/api\/nook-note'/);
  assert.match(composer, /characterId, title: title\.trim\(\), body: body\.trim\(\), clientRef/);
  assert.match(composer, /result\.path \?\? result\.details\?\.path/);
  assert.match(composer, /event\.preventDefault\(\)/);
  assert.match(composer, /disabled \|\| busy/);
  assert.match(composer, /onCreated\?\.\(\)/);
});

test('Nook projects the character metadata media through a draggable portrait outside the card canvas', () => {
  assert.match(nook, /character: CharacterMediaSnapshot/);
  assert.match(nook, /effectsEnabled: boolean/);
  assert.match(nook, /data-nook-zone="character-media"/);
  assert.match(nook, /<NookPortrait/);
  assert.match(nook, /worldId=\{worldId\}/);
  assert.match(nook, /video=\{avatarVideo \?\? undefined\}/);
  assert.match(nook, /poster=\{avatar \?\? undefined\}/);
  assert.match(nook, /stillPortraits/);
  assert.match(portrait, /className="nook-character-media__asset"/);
  assert.match(portrait, /onPointerDown/);
  assert.match(portrait, /onPointerMove/);
  assert.match(portrait, /ArrowLeft/);
  assert.doesNotMatch(nook, /sceneFrontmatter\?\.avatar/);
});

test('character media failure falls through once to static, then name fallback', () => {
  assert.match(media, /const \[failedVideo, setFailedVideo\]/);
  assert.match(media, /const \[failedPoster, setFailedPoster\]/);
  assert.match(media, /onError=\{\(\) => markVideoFailed\(video!\)\}/);
  assert.match(media, /if \(poster && !failedPoster\)/);
  assert.match(media, /return <>\{fallback\}<\/>/);
});


test('camera slots use Canvas layer keys and clear remembered slots', () => {
  assert.match(camera, /export function cameraSlot/);
  assert.match(camera, /if \(projection === 'layer'\) return identity/);
  assert.match(camera, /characters\/\$\{identity\}/);
  assert.match(camera, /for \(const slot of knownSlots\) clearSlot\(slot\)/);
});
