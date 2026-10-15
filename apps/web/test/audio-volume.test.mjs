import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

test('independent persisted bus volumes, including zero, without changing master or restarting audio', async () => {
  const saved = new Map([['airp-volume-music', '0.3'], ['airp-volume-voice', '0.8']]);
  const gains = [];
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  class AudioContext {
    currentTime = 2;
    destination = {};
    createGain() {
      const node = {
        gain: {
          value: 1,
          cancelScheduledValues() {},
          setValueAtTime(value) { this.value = value; },
          linearRampToValueAtTime(value) { this.value = value; },
        },
        connect(target) { this.target = target; },
      };
      gains.push(node);
      return node;
    }
  }
  globalThis.window = { AudioContext };
  try {
    const audio = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/audio.ts');
    audio.initAudio();
    const [master, music, voice] = gains;
    assert.equal(music.gain.value, 0.3);
    assert.equal(voice.gain.value, 0.8);
    assert.equal(music.target, master);
    assert.equal(voice.target, master);
    audio.setChannelVolume('music', 0);
    assert.equal(music.gain.value, 0);
    assert.equal(voice.gain.value, 0.8);
    audio.setChannelVolume('voice', 0.4);
    assert.equal(voice.gain.value, 0.4);
    assert.equal(music.gain.value, 0);
    assert.equal(saved.get('airp-volume-voice'), '0.4');
    audio.setMuted(true);
    audio.setMuted(false);
    assert.equal(music.gain.value, 0);
    assert.equal(voice.gain.value, 0.4);
    audio.setChannelVolume('voice', Number.NaN);
    assert.equal(voice.gain.value, 0.4);
    audio.setChannelVolume('voice', 9);
    assert.equal(audio.getChannelVolume('voice'), 1);
    assert.equal(gains.length, 3);
  } finally {
    globalThis.window = previousWindow;
    globalThis.localStorage = previousStorage;
  }
});

test('music samples and synth fallback share the music bus, while voice uses its own bus', () => {
  const source = fs.readFileSync(new URL('../src/lib/audio.ts', import.meta.url), 'utf8');
  assert.match(source, /track === 'ambient' \? master : musicBus!/);
  for (const name of ['calmG', 'tenseG', 'crisisG']) assert.ok(source.includes(`${name}.connect(musicBus!)`));
  assert.match(source, /playClip\(voiceBus!, buf/);
});

test('channel preference APIs remain safe without Web Audio', async () => {
  const audio = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/audio.ts');
  assert.equal(audio.initAudio(), null);
  assert.doesNotThrow(() => audio.setChannelVolume('music', 0.25));
  assert.equal(audio.getChannelVolume('music'), 0.25);
  assert.doesNotThrow(() => audio.setChannelVolume('voice', 0.75));
  assert.equal(audio.getChannelVolume('voice'), 0.75);
});
test('TtsSettings exposes independent accessible channel sliders backed by the real API', () => {
  const source = fs.readFileSync(new URL('../src/components/TtsSettings.tsx', import.meta.url), 'utf8');
  assert.match(source, /getChannelVolume, setChannelVolume/);
  assert.match(source, /id="music-volume" type="range" role="slider" min="0" max="100" step="1"/);
  assert.match(source, /id="voice-volume" type="range" role="slider" min="0" max="100" step="1"/);
  assert.match(source, /aria-valuenow=\{volumes\.music\}/);
  assert.match(source, /aria-valuenow=\{volumes\.voice\}/);
  assert.match(source, /t\('\{value\}%', \{ value: volumes\.music \}\)/);
  assert.match(source, /t\('\{value\}%', \{ value: volumes\.voice \}\)/);
});

test('TtsSettings clamps slider boundaries before converting to channel values', () => {
  const source = fs.readFileSync(new URL('../src/components/TtsSettings.tsx', import.meta.url), 'utf8');
  assert.match(source, /Math\.min\(100, Math\.max\(0, Math\.round\(value\)\)\)/);
  assert.match(source, /percent \/ 100/);
  assert.match(source, /Math\.min\(1, Math\.max\(0, value\)\) \* 100/);
});

test('TtsSettings volume changes do not own or alter master mute', () => {
  const source = fs.readFileSync(new URL('../src/components/TtsSettings.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /setMuted|toggleMuted/);
});

test('voice uses a 5ms click-safe attack while music keeps the 1.5s crossfade', async () => {
  const gains = [];
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  class AudioContext {
    currentTime = 2;
    state = 'running';
    destination = {};
    createGain() {
      const events = [];
      const node = {
        events,
        gain: {
          value: 1,
          cancelScheduledValues() {},
          setValueAtTime(value, time) { this.value = value; events.push(['set', value, time]); },
          linearRampToValueAtTime(value, time) { this.value = value; events.push(['ramp', value, time]); },
        },
        connect(target) { this.target = target; },
        disconnect() {},
      };
      gains.push(node);
      return node;
    }
    createBufferSource() {
      return { buffer: null, loop: false, connect(target) { this.target = target; }, disconnect() {}, start() {}, stop() {}, onended: null };
    }
    async decodeAudioData() { return {}; }
  }
  globalThis.window = { AudioContext, setTimeout };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  try {
    const audio = await createJiti(import.meta.url, { moduleCache: false }).import('../src/lib/audio.ts');
    audio.playVoice('/voice.wav');
    await new Promise(resolve => setTimeout(resolve, 0));
    const voiceBus = gains[2];
    const voiceGain = gains.find(node => node.target === voiceBus);
    assert.deepEqual(voiceGain.events.slice(-2), [['set', 0, 2], ['ramp', 0.85, 2.005]]);

    audio.setTheme('/music.wav');
    await new Promise(resolve => setTimeout(resolve, 0));
    const musicBus = gains[1];
    const musicGain = gains.find(node => node.target === musicBus);
    assert.deepEqual(musicGain.events.slice(-2), [['set', 0, 2], ['ramp', 0.22, 3.5]]);
  } finally {
    globalThis.window = previousWindow;
    globalThis.localStorage = previousStorage;
    globalThis.fetch = previousFetch;
  }
});
