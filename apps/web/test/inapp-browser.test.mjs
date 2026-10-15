// In-app browser guide (lib/inapp-browser.ts + main.tsx): UA detection, guide language, the copied link keeps
// ?src= / ?invite=, "try anyway" per session, and attribution is not stripped from the address bar while the
// guide is up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const I = await jiti.import('../src/lib/inapp-browser.ts');

const UA = {
  wechatIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003137) NetType/WIFI Language/zh_CN',
  wechatAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0 XWEB/1220099 MMWEBSDK/20240301 Mobile Safari/537.36 MMWEBID/1 MicroMessenger/8.0.48.2580(0x28003036) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64',
  wxwork: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 wxwork/4.1.20 MicroMessenger/7.0.1 Language/zh ColorScheme/Light',
  qq: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 QQ/9.0.8.611 V1_IPH_SQ_9.0.8_1_APP_A Pixel/1179 Core/WKWebView NetType/WIFI QBWebViewType/1',
  mqqbrowser: 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; V2241A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/109.0 MQQBrowser/14.5 Mobile Safari/537.36',
  weibo: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Weibo (iPhone15,2__weibo__14.3.0__iphone__os17.0)',
  douyin: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 aweme_29.0.0 JsSdk/2.0 NetType/WIFI Channel/App Store',
  tiktok: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 trill_330004 BytedanceWebview/d8a21c6',
  xhs: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 xhsdiscover/8.30 rnver/8.30.0 NetType/WiFi',
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.5.0',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0.0 (iPhone15,2; iOS 17_0; en_US)',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0;FBBV/1;FBDV/iPhone15,2]',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};

test('in-app browsers are detected with their OS; real browsers are not', () => {
  assert.deepEqual(I.detectInApp(UA.wechatIos), { app: 'wechat', os: 'ios' });
  assert.deepEqual(I.detectInApp(UA.wechatAndroid), { app: 'wechat', os: 'android' });
  assert.equal(I.detectInApp(UA.wxwork).app, 'wxwork');
  assert.equal(I.detectInApp(UA.qq).app, 'qq');
  assert.equal(I.detectInApp(UA.weibo).app, 'weibo');
  assert.equal(I.detectInApp(UA.douyin).app, 'douyin');
  assert.deepEqual(I.detectInApp(UA.tiktok), { app: 'tiktok', os: 'android' });
  assert.equal(I.detectInApp(UA.xhs).app, 'xiaohongshu');
  assert.equal(I.detectInApp(UA.line).app, 'line');
  assert.equal(I.detectInApp(UA.instagram).app, 'instagram');
  assert.equal(I.detectInApp(UA.facebook).app, 'facebook');
  for (const ua of [UA.safari, UA.chrome, UA.mqqbrowser, UA.ipadSafari, '', null]) assert.equal(I.detectInApp(ua), null);
  assert.equal(I.inAppOs(UA.ipadSafari, 5), 'ios');
});

test('guide language = the interface language (?lang= → stored → English), no app / browser guess', async () => {
  assert.equal(I.guideLocale, undefined, 'the Chinese-app / browser-language guess is gone');
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /initialLocale=\{currentLocale\(\)\}/);
  assert.doesNotMatch(main, /navigator\.languages/);
  // "Try anyway" keeps a language picked on the guide, and only then takes ?lang= out of the address.
  assert.match(main, /if \(picked !== currentLocale\(\)\) setLocale\(picked\);/);
});

test('copied link keeps ?src= and ?invite=, adds the guide language, drops the hash', () => {
  assert.equal(I.guideLink('https://canvas.worldlines.gg/?src=wechat-group&invite=WL-ABC123#x'), 'https://canvas.worldlines.gg/?src=wechat-group&invite=WL-ABC123');
  assert.equal(I.guideLink('https://canvas.worldlines.gg/?src=wechat-group&invite=WL-ABC123#x', 'zh-CN'), 'https://canvas.worldlines.gg/?src=wechat-group&invite=WL-ABC123&lang=zh');
  assert.equal(I.guideLink('https://canvas.worldlines.gg/?lang=zh&src=xhs', 'ja'), 'https://canvas.worldlines.gg/?lang=ja&src=xhs');
  assert.equal(I.guideLink('not a url', 'en'), 'not a url');
  // 「··· → 在 Safari 中打开」 opens the address bar: it carries the guide's language too.
  assert.equal(I.addressWithLang('https://canvas.worldlines.gg/?src=wechat-group#x', 'ko'), '/?src=wechat-group&lang=ko#x');
});

test('"try anyway" is remembered per session; ?inapp=0 skips the guide', () => {
  const m = new Map();
  const kv = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  assert.deepEqual(I.shouldShowInAppGuide(UA.wechatIos, '?src=x', kv), { app: 'wechat', os: 'ios' });
  assert.equal(I.shouldShowInAppGuide(UA.wechatIos, '?inapp=0', kv), null);
  assert.equal(I.shouldShowInAppGuide(UA.safari, '', kv), null);
  I.rememberInAppContinue(kv);
  assert.equal(I.shouldShowInAppGuide(UA.wechatIos, '', kv), null);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.ok(I.shouldShowInAppGuide(UA.wechatIos, '', blocked));
  assert.doesNotThrow(() => I.rememberInAppContinue(blocked));
});

test('main.tsx: the guide comes before the runtime boot, and attribution waits for "try anyway"', async () => {
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /if \(!inApp\) \{\s*dropLangParam\(\);\s*captureAttribution\(\);\s*captureInviteParam\(\);/);
  const cont = main.slice(main.indexOf('onContinue={(picked) => {'));
  assert.ok(cont.indexOf('dropLangParam()') < cont.indexOf('boot()'));
  assert.ok(cont.indexOf('captureAttribution()') < cont.indexOf('boot()'));
  assert.ok(main.indexOf('const boot = () =>') < main.indexOf('if (inApp) {'));
  // No new analytics event names (chronicle keeps a closed list).
  assert.doesNotMatch(main, /track\(/);
});
