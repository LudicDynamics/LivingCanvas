// Motion-clip keeps a pure core so this can run without ffmpeg or a real clip.
//
// What this defends: the despill `expand` DEFAULT. It was 0.4 for a while, and
// nothing failed — the only symptom was that off-white clothing came out pink,
// which nobody had a test for. Measured on three plates: `mix` alone already
// drives edge spill to zero, and `expand` only eats the subject's green channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAlphaFilter, parseArgs } from './motion-clip.mjs';

const base = (extra = {}) => ({
  ...parseArgs(['in.mp4', '-o', 'out.webm']),
  screenType: 'green',
  scale: 0,
  ...extra,
});

test('despill leaves the subject colour alone by default (expand=0)', () => {
  const opts = base();
  assert.equal(opts.despillExpand, 0, 'expand must default to 0, matching ffmpeg');
  assert.equal(opts.despillMix, 0.6);
  assert.match(buildAlphaFilter(opts, '0x15ad23'), /despill=type=green:mix=0\.6:expand=0/);
});

test('expand remains reachable for a plate that still fringes', () => {
  const opts = base({ despillExpand: 0.4 });
  assert.match(buildAlphaFilter(opts, '0x15ad23'), /expand=0\.4/);
  assert.equal(parseArgs(['in', '-o', 'o', '--despill-expand', '0.3']).despillExpand, 0.3);
});

test('--no-despill drops the pass entirely rather than zeroing it', () => {
  const opts = base({ despill: false });
  assert.doesNotMatch(buildAlphaFilter(opts, '0x15ad23'), /despill=/);
});

test('key and loop knobs survive into the filter chain', () => {
  const chain = buildAlphaFilter(base({ similarity: 0.08, blend: 0.06, trimStart: 20 }), '0x1e8549');
  assert.match(chain, /trim=start_frame=20/);
  assert.match(chain, /chromakey=0x1e8549:0\.08:0\.06/);
  assert.match(chain, /format=yuva420p$/);
});
