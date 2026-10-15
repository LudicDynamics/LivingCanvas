// Which interface language a visitor gets:
// ?lang= → the stored pick → ENGLISH (the browser's languages are only a suggestion on the
// first-run language page); a world's language never overrides the player's own pick.
// Also: the boot screen's own table, index.html's first paint (its inline scripts, run here),
// and the canvas links that carry ?lang= (lib/canvas-link.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
const await_read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
import vm from 'node:vm';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const i18n = await jiti.import('../src/lib/i18n.ts');
const { bootText, bootScreens, injectBootScreens } = await jiti.import('../src/lib/boot-copy.ts');
const { canvasLink, withLang } = await jiti.import('../src/lib/canvas-link.ts');
const invite = await jiti.import('../src/lib/invite.ts');

test('?lang= wins over a stored pick and the browser, and counts as a choice', () => {
  assert.deepEqual(i18n.initialLocale({ search: '?lang=en', stored: 'zh-CN', languages: ['zh-CN'] }), { locale: 'en', chosen: true });
  assert.deepEqual(i18n.initialLocale({ search: '?src=x&lang=zh-TW', stored: null, languages: ['en-US'] }), { locale: 'zh-CN', chosen: true });
  assert.equal(i18n.langParam('?lang=jp'), 'ja');
  assert.equal(i18n.langParam('?lang=ko_KR'), 'ko');
  assert.equal(i18n.langParam('?lang=fr'), null);
  assert.equal(i18n.langParam(''), null);
});

test('every ?lang= spelling we hand out', () => {
  const cases = { en: 'en', 'en-US': 'en', ja: 'ja', jp: 'ja', 'ja-JP': 'ja', ko: 'ko', 'ko-KR': 'ko', zh: 'zh-CN', 'zh-CN': 'zh-CN', 'zh-cn': 'zh-CN', 'zh-TW': 'zh-CN', 'zh-Hant': 'zh-CN', ZH: 'zh-CN' };
  for (const [flag, locale] of Object.entries(cases)) {
    assert.deepEqual(i18n.initialLocale({ search: `?src=site&lang=${flag}`, stored: null }), { locale, chosen: true }, flag);
    assert.deepEqual(i18n.initialLocale({ search: `?lang=${flag}`, stored: 'ko' }), { locale, chosen: true }, `${flag} over a stored pick`);
  }
});

test('without ?lang= a stored pick wins; with neither, English — never the browser languages', () => {
  assert.deepEqual(i18n.initialLocale({ search: '', stored: 'ja' }), { locale: 'ja', chosen: true });
  assert.deepEqual(i18n.initialLocale({ search: '?lang=xx', stored: 'zh-CN' }), { locale: 'zh-CN', chosen: true });
  assert.deepEqual(i18n.initialLocale({ search: '', stored: null, languages: ['zh-CN', 'zh', 'en'] }), { locale: 'en', chosen: false });
  assert.deepEqual(i18n.initialLocale({ search: '?lang=xx', stored: null, languages: ['ja'] }), { locale: 'en', chosen: false });
  assert.deepEqual(i18n.initialLocale({ search: null, stored: '' }), { locale: 'en', chosen: false });
  assert.equal(i18n.DEFAULT_LOCALE, 'en');
  // The browser's languages survive only as the language page's suggestion.
  assert.equal(i18n.detectLocale(['zh-CN', 'en']), 'zh-CN');
  const app = await_read('../src/App.tsx');
  assert.match(app, /suggested=\{firstRunSuggestion\}/);
  assert.match(app, /localeChosen\(\) \? null : suggestedLocale\(\)/);
  const src = await_read('../src/lib/i18n.ts');
  assert.doesNotMatch(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'), /initialLocale\(\{[^}]*languages/, 'page load ignores navigator.languages');
});

test('a world’s language shows only to a player who never picked one and whose (stated) languages include it', () => {
  // An English reader opening a Chinese world keeps English.
  assert.equal(i18n.worldLocaleFor('zh-CN', { chosen: false, languages: ['en-US', 'en'], current: 'en' }), null);
  // A bilingual browser follows the world while it is open.
  assert.equal(i18n.worldLocaleFor('ja', { chosen: false, languages: ['en-US', 'ja'], current: 'en' }), 'ja');
  // A player who picked a language (or came by ?lang=) is never switched.
  assert.equal(i18n.worldLocaleFor('ja', { chosen: true, languages: ['ja'], current: 'en' }), null);
  // Same language, or no language: nothing to do.
  assert.equal(i18n.worldLocaleFor('en', { chosen: false, languages: ['en'], current: 'en' }), null);
  assert.equal(i18n.worldLocaleFor(undefined, { chosen: false, languages: ['ja'], current: 'en' }), null);
});

test('the open world never writes its language into the stored or synced preference', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /followWorldLocale\(manifest\?\.locale \?\? null\)/);
  assert.doesNotMatch(app, /setLocale\(manifest\.locale\)/);
  const sync = await readFile(new URL('../src/lib/account-data-app.ts', import.meta.url), 'utf8');
  assert.match(sync, /locale: preferredLocale\(\)/);
});

test('the browser boot screen speaks the interface language (English visitors used to get Chinese)', async () => {
  assert.match(bootText('en', 'title'), /Opening your/);
  assert.equal(bootText('zh-CN', 'failed'), '启动失败');
  for (const locale of ['en', 'zh-CN', 'ja', 'ko']) for (const line of ['title', 'description', 'connecting', 'registering', 'preparing', 'starting', 'failed', 'swControl']) {
    assert.ok(bootText(locale, line), `${locale} ${line}`);
  }
  // Code only: comments may be Chinese, copy may not.
  const code = (text) => text.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).map((l) => l.replace(/\s\/\/\s.*$/, '')).join('\n');
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(code(main), /\p{Script=Han}/u, 'main.tsx has no hard-coded Chinese copy');
  const mode = await readFile(new URL('../src/lib/browser-mode.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(code(mode), /status\('[^']*\p{Script=Han}/u);
});

// ── index.html's first paint ──────────────────────────────────────────────────────────────────────────────
/** Run index.html's inline scripts (as built: screens injected, browser mode `always`) against a fake page. */
function firstPaint({ search = '', stored = null, storageThrows = false, mode = 'always' } = {}) {
  const html = injectBootScreens(await_read('../index.html')).replace(/%VITE_AIRP_BROWSER_MODE%/g, mode);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const root = { firstChild: null, innerHTML: '' };
  const documentElement = { lang: 'en' };
  const window = {};
  const ctx = {
    window, location: { search, href: `https://canvas.worldlines.gg/${search}` },
    localStorage: { getItem: (k) => { if (storageThrows) throw new Error('blocked'); return k === 'airp-ui-locale' ? stored : null; } },
    document: { documentElement, getElementById: (id) => (id === 'root' ? root : null) },
    navigator: { languages: ['zh-CN', 'zh'], language: 'zh-CN' }, // a Chinese browser: must not matter
    URLSearchParams, decodeURIComponent,
  };
  vm.createContext(ctx);
  for (const code of scripts) vm.runInContext(code, ctx);
  return { locale: window.__airpBootLocale, lang: documentElement.lang, html: root.innerHTML };
}

test('index.html picks the language before any bundle, with the same rule as i18n.ts', () => {
  const cases = [
    { search: '' }, { search: '?lang=en' }, { search: '?lang=ja' }, { search: '?lang=jp' }, { search: '?lang=ko' },
    { search: '?lang=zh' }, { search: '?lang=zh-CN' }, { search: '?lang=zh-TW' }, { search: '?src=site&lang=zh&invite=WL-ABCDEF' },
    { search: '?lang=xx' }, { search: '?lang=%E4%B8%AD' }, { search: '?lang=zh_tw' },
    { search: '', stored: 'ja' }, { search: '', stored: 'zh-CN' }, { search: '', stored: 'fr' }, { search: '?lang=en', stored: 'zh-CN' },
    { search: '?lang=ko', storageThrows: true }, { search: '', storageThrows: true },
  ];
  for (const c of cases) {
    const want = i18n.initialLocale({ search: c.search, stored: c.storageThrows ? null : (c.stored ?? null) }).locale;
    const got = firstPaint(c);
    assert.equal(got.locale, want, JSON.stringify(c));
    assert.equal(got.lang, want, `<html lang> ${JSON.stringify(c)}`);
  }
});

test('first paint: the boot screen is already there, in that language — no Chinese for anyone else', () => {
  const han = /\p{Script=Han}/u;
  const kana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const en = firstPaint({ search: '?lang=en' });
  assert.match(en.html, /class="browser-boot"/);
  assert.match(en.html, /Opening your<br \/>world/);
  assert.doesNotMatch(en.html, han, 'English first paint has no Chinese');
  assert.doesNotMatch(en.html, kana);
  const none = firstPaint({});
  assert.match(none.html, /Opening your<br \/>world/, 'no flag, nothing stored → English');
  assert.doesNotMatch(none.html, han, 'a Chinese browser without a flag still gets English');
  assert.match(firstPaint({ search: '?lang=zh' }).html, /正在为你<br \/>打开世界/);
  assert.match(firstPaint({ search: '?lang=ja' }).html, /ワールドを<br \/>開いています/);
  assert.match(firstPaint({ search: '?lang=ko' }).html, /세계를<br \/>여는 중/);
  assert.doesNotMatch(firstPaint({ search: '?lang=ko' }).html, han);
  assert.match(firstPaint({ stored: 'zh-CN' }).html, /data-boot-locale="zh-CN"/);
  // Not the static site (local build / dev): nothing drawn, main.tsx decides.
  assert.equal(firstPaint({ search: '?lang=en', mode: '%VITE_AIRP_BROWSER_MODE%' }).html, '');
  // The static markup itself (outside scripts and comments) has no Chinese.
  const markup = await_read('../index.html').replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const visible = markup.replace(/<meta[^>]*(og:description|twitter:description)[^>]*>/g, ''); // the share preview speaks all three
  assert.doesNotMatch(visible, han);
});

test('the injected screens are boot-copy.ts’s, and main.tsx keeps the drawn one', () => {
  const screens = bootScreens(true);
  assert.deepEqual(Object.keys(screens).sort(), ['en', 'ja', 'ko', 'zh-CN']);
  for (const [l, html] of Object.entries(screens)) {
    assert.ok(html.includes(`data-boot-locale="${l}"`), l);
    assert.ok(html.includes(bootText(l, 'connecting')), l);
  }
  const main = await_read('../src/main.tsx');
  assert.match(main, /getAttribute\('data-boot-locale'\) !== bootLocale\) root\.innerHTML = bootScreenHtml\(bootLocale/);
  assert.match(await_read('../vite.config.ts'), /transformIndexHtml: \(html: string\) => injectBootScreens\(html\)/);
  // ?lang= leaves the address only after the in-app guide (its "Open in Safari" uses the address bar).
  assert.equal((main.match(/dropLangParam\(\);/g) ?? []).length, 2);
});

// ── links ─────────────────────────────────────────────────────────────────────────────────────────────────
test('canvasLink: every canvas link says its language', () => {
  assert.equal(canvasLink('/', 'en'), 'https://canvas.worldlines.gg/?lang=en');
  assert.equal(canvasLink('/?src=site', 'zh-CN'), 'https://canvas.worldlines.gg/?src=site&lang=zh');
  assert.equal(canvasLink('/?lang=ko&invite=WL-ABCDEF#x', 'ja'), 'https://canvas.worldlines.gg/?lang=ja&invite=WL-ABCDEF#x');
  assert.equal(canvasLink('https://canvas.worldlines.gg/?invite=WL-ABCDEF', 'ko'), 'https://canvas.worldlines.gg/?invite=WL-ABCDEF&lang=ko');
  assert.equal(canvasLink('https://example.com/x', 'ja'), 'https://example.com/x', 'another host is left alone');
  assert.equal(withLang('https://discord.gg/abc', 'ja'), 'https://discord.gg/abc');
  assert.equal(withLang('http://localhost:5173/?invite=WL-ABCDEF', 'zh-CN', 'http://localhost:5173'), 'http://localhost:5173/?invite=WL-ABCDEF&lang=zh');
  // Every value it writes reads back as that language.
  for (const l of ['en', 'ja', 'ko', 'zh-CN']) assert.equal(i18n.langParam(new URL(canvasLink('/', l)).search), l);
});

test('invite and share-card links carry the sharer’s language', async () => {
  assert.equal(invite.inviteShareUrl('WL-ABCDEF', undefined, 'ja'), 'https://canvas.worldlines.gg/?invite=WL-ABCDEF&lang=ja');
  assert.equal(invite.inviteLinkFor({ code: 'WL-ABCDEF', shareUrl: 'https://canvas.worldlines.gg/?invite=WL-ABCDEF' }, 'zh-CN'), 'https://canvas.worldlines.gg/?invite=WL-ABCDEF&lang=zh');
  assert.equal(invite.inviteLinkFor({ code: 'WL-ABCDEF', shareUrl: '' }, 'en'), 'https://canvas.worldlines.gg/?invite=WL-ABCDEF&lang=en');
  const dialog = await_read('../src/components/chrome/ShareCardDialog.tsx');
  assert.match(dialog, /const link = withLang\(props\.url, locale\)/);
  assert.doesNotMatch(dialog, /props\.url(?!, locale)/, 'the card, the system share and "copy link" all use the language link');
  const friends = await_read('../src/components/chrome/InviteFriends.tsx');
  assert.match(friends, /inviteLinkFor\(info, locale\)/);
  assert.doesNotMatch(friends, /info\.shareUrl/);
});

test('the sign-in callback page (back on canvas) follows the stored interface language, not Accept-Language', () => {
  const remote = await_read('../../server/src/routes/remote.ts');
  assert.doesNotMatch(remote, /acceptsLanguages/);
  assert.match(remote, /localStorage\.getItem\('airp-ui-locale'\)==='zh-CN'/);
});

test('the first-run language page only marks the browser’s language; the selected one is the interface language', () => {
  const page = await_read('../src/components/chrome/FirstRun.tsx');
  assert.match(page, /aria-checked=\{l === locale\}/);
  assert.match(page, /l === suggested && l !== locale \? 'first-run__lang first-run__lang--suggested'/);
  assert.match(await_read('../src/components/chrome/first-run.css'), /\.first-run__lang--suggested \{/);
});
