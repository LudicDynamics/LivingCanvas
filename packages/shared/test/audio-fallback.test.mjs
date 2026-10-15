// platformAudioFallback (rules/music.ts): every file a copy may lack has a redistributable stand-in that exists.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { MUSIC_CATALOG, platformAudioFallback } from '../dist/index.js';

const AUDIO = new URL('../../../assets/audio/', import.meta.url);

test('MaouDamashii themes, canvas sounds and the launcher theme fall back to shipped CC0 / CC-BY files', () => {
  const absent = [
    ...MUSIC_CATALOG.filter(t => t.fallback).map(t => t.file),
    ...['card', 'get', 'dice', 'success', 'write', 'door', 'paper', 'bell'].map(n => `foley/canvas/se-${n}.mp3`),
    'licensed/launcher.mp3',
  ];
  assert.ok(absent.length >= 14);
  for (const rel of absent) {
    const stand = platformAudioFallback(rel);
    assert.ok(stand, `${rel} has a stand-in`);
    assert.ok(!/canvas|licensed|maou|suno/.test(stand), `${rel} → ${stand} is redistributable`);
    assert.ok(existsSync(new URL(stand, AUDIO)), `${stand} ships`);
  }
  assert.equal(platformAudioFallback('bgm/calm.mp3'), null);
});
