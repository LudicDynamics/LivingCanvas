// The contact panel's invariants. The region comes from the
// language the player chose, so that mapping is tested as the pure function it
// is; the rest are source assertions, because the point of most of them is that
// a placeholder can never ship looking like a real invite.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const community = await jiti.import('../src/lib/community.ts');
const {
  regionForLocale,
  isCommunityRegion,
  otherRegions,
  channelHref,
  COMMUNITY_CHANNELS,
  REGION_LABELS,
  REGIONS,
  TODO_PREFIX,
} = community;

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const launcher = await readFile(new URL('../src/components/WorldLauncher.tsx', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/chrome/ContactPanel.tsx', import.meta.url), 'utf8');
const lib = await readFile(new URL('../src/lib/community.ts', import.meta.url), 'utf8');
const messages = JSON.parse(await readFile(new URL('../src/lib/messages.json', import.meta.url), 'utf8'));

test('the language the player chose decides the default list', () => {
  assert.equal(regionForLocale('zh-CN'), 'mainland');
  assert.equal(regionForLocale('ja'), 'japan');
  assert.equal(regionForLocale('en'), 'international');
  // A locale the app does not have still has to answer with a usable list.
  assert.equal(regionForLocale('de'), 'international');
  assert.equal(regionForLocale(undefined), 'international');
  // `greater-china` is reachable only by the player picking it: the app has one
  // Chinese button, so nothing can infer Hong Kong / Taiwan from the language.
  assert.ok(REGIONS.includes('greater-china'));
  for (const locale of ['zh-CN', 'ja', 'en']) {
    assert.notEqual(regionForLocale(locale), 'greater-china');
  }
});

test('every region has channels, each labelled, with no duplicate kind', () => {
  for (const region of REGIONS) {
    const channels = COMMUNITY_CHANNELS[region];
    assert.ok(Array.isArray(channels) && channels.length > 0, region);
    assert.ok(REGION_LABELS[region], `${region} needs a label`);
    const kinds = channels.map(channel => channel.kind);
    assert.equal(new Set(kinds).size, kinds.length, `${region} lists a kind twice`);
    for (const channel of channels) {
      assert.ok(channel.label && typeof channel.label === 'string', `${region}/${channel.kind} needs a label`);
      assert.ok(messages[channel.label], `${region}/${channel.kind}: "${channel.label}" is missing from messages.json`);
      assert.equal(typeof channel.value, 'string', `${region}/${channel.kind} needs a value`);
      // A scan-only channel legitimately has no id to show — but then it MUST
      // carry a QR, or the row offers no way in at all.
      assert.ok(channel.value || channel.qr, `${region}/${channel.kind}: no value and no QR leaves no way to join`);
    }
  }
  // The Chinese list leads with the two channels that work behind the
  // firewall; Discord is listed, but last — a zh-CN reader may be anywhere,
  // and ordering is the whole way this list expresses "try this first".
  assert.equal(COMMUNITY_CHANNELS.mainland[0].kind, 'wechat');
  assert.equal(COMMUNITY_CHANNELS.mainland[1].kind, 'qq');
  const mainlandKinds = COMMUNITY_CHANNELS.mainland.map(channel => channel.kind);
  assert.ok(mainlandKinds.indexOf('discord') > mainlandKinds.indexOf('qq'));
  assert.equal(COMMUNITY_CHANNELS.international[0].kind, 'discord');
});

test('placeholders are marked, and a marked channel is never linkable', () => {
  for (const region of REGIONS) {
    for (const channel of COMMUNITY_CHANNELS[region]) {
      if (channel.value.includes(TODO_PREFIX)) {
        assert.equal(channel.todo, true, `${region}/${channel.kind}: a TODO value must carry todo: true`);
      }
      // A pending channel must not produce an href — that is what stops an
      // unfilled invite from rendering as a real-looking link.
      if (channel.todo) assert.equal(channelHref(channel), null, `${region}/${channel.kind}`);
    }
  }
  // And the panel says so rather than showing the placeholder string.
  assert.match(panel, /Not published yet/);
  assert.match(panel, /Coming soon/);
});

test('channelHref builds a real link only from a filled value', () => {
  assert.equal(channelHref({ kind: 'email', label: 'Email', value: 'hello@worldlines.gg' }), 'mailto:hello@worldlines.gg');
  assert.equal(channelHref({ kind: 'discord', label: 'Discord', value: 'abc123' }), 'https://discord.gg/abc123');
  assert.equal(channelHref({ kind: 'discord', label: 'Discord', value: 'https://discord.gg/abc123' }), 'https://discord.gg/abc123');
  assert.equal(channelHref({ kind: 'x', label: 'X', value: '@worldlines' }), 'https://x.com/worldlines');
  // WeChat and QQ are joined by scanning or pasting; a link would open nothing.
  assert.equal(channelHref({ kind: 'wechat', label: 'WeChat official account', value: 'worldlines' }), null);
  assert.equal(channelHref({ kind: 'qq', label: 'QQ group', value: '123456' }), null);
});

test('nothing sniffs the environment: the language already answered', () => {
  // Strip comments first: the module's docstring names these to explain why it
  // does NOT use them, and that sentence is worth keeping.
  const code = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [name, source] of [['community.ts', lib], ['ContactPanel.tsx', panel]]) {
    assert.doesNotMatch(code(source), /fetch\(/, name);
    assert.doesNotMatch(code(source), /ipapi|ipinfo|geoip|maxmind|ip-api/i, name);
    assert.doesNotMatch(code(source), /resolvedOptions\(\)|navigator\.language|document\.cookie/, name);
  }
  // The one input, and the one place it comes from.
  assert.match(lib, /regionForLocale/);
  assert.match(panel, /regionForLocale\(locale\)/);
});

test('both chromes mount the same panel, and the choice is the player’s', () => {
  assert.match(app, /import \{ ContactPanel \}/);
  assert.match(app, /<ContactPanel focus=\{focusCoordinator\} \/>/);
  assert.match(launcher, /import \{ ContactPanel \}/);
  assert.match(launcher, /<ContactPanel focus=\{focus\} variant="launcher" \/>/);
  // One surface key, so Escape and the outside-press rule treat it like the
  // dock and the writer sheet instead of stacking a second contact panel.
  assert.equal((panel.match(/key: 'contact-panel'/g) ?? []).length, 1);
  assert.match(panel, /otherRegions\(region\)/);
  assert.match(panel, /writeRegion\(next\)/);
  // An explicit choice outranks the language; no choice means the language
  // keeps deciding, so switching to 日本語 moves the default list with it.
  assert.match(panel, /chosen \?\? regionForLocale\(locale\)/);
});

test('the launcher entry sits in the top bar; the header entry is icon-only', () => {
  // Launcher: inside the top bar's own nav, the row that also holds the
  // language buttons and the saves / continue pills.
  const top = launcher.slice(launcher.indexOf('world-launcher__top'), launcher.indexOf('world-launcher__stage'));
  assert.match(top, /world-launcher__langs/);
  assert.match(top, /<ContactPanel focus=\{focus\} variant="launcher" \/>/);
  assert.match(top, /world-launcher__pill/);
  // Header: no word, so the name must reach assistive tech another way.
  assert.match(panel, /contact-panel__icon/);
  assert.match(panel, /<MessageCircle aria-hidden="true" \/>/);
  assert.match(panel, /aria-label=\{variant === 'launcher' \? undefined : label\}/);
  assert.match(panel, /const label = t\('Contact us'\)/);
  assert.ok(messages['Contact us'], '"Contact us" is missing from messages.json');
});

test('isCommunityRegion and otherRegions stay in step with REGIONS', () => {
  for (const region of REGIONS) {
    assert.ok(isCommunityRegion(region));
    const others = otherRegions(region);
    assert.equal(others.length, REGIONS.length - 1);
    assert.ok(!others.includes(region));
  }
  assert.equal(isCommunityRegion('moon'), false);
  assert.equal(isCommunityRegion(undefined), false);
});
