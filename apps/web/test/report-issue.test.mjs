// 「报告问题 / 卡住了」 (lib/report-issue.ts, components/chrome/ReportIssue.tsx, the design notes): the body carries only what the
// sheet showed (world, edition, place, version, error codes — never conversation text); the send result maps the
// server's answers (sent / signed_out / unavailable / rate_limited); error codes are chronicle's fingerprints; and the
// two entries (world header beside 联系我们, inside the 联系我们 panel) open the one sheet mounted in App.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const R = await jiti.import('../src/lib/report-issue.ts');
const A = await jiti.import('../src/lib/analytics.ts');
const src = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const CTX = { worldId: 'last-train', edition: 'last-train-jp', worldName: '末班车', place: 'world/platform', placeTitle: '月台', version: 'v2026.10.09', mode: 'browser', locale: 'zh-CN' };
const FP = 'ab'.repeat(16);

test('reportBody: the shown context only; edition only when it differs; text trimmed and capped; error codes filtered', () => {
  assert.deepEqual(R.reportBody('stuck', '  门打不开 ', CTX, [FP, 'nope', FP]), {
    kind: 'stuck', text: '门打不开', world_id: 'last-train', edition: 'last-train-jp', place: 'world/platform', place_title: '月台',
    client_version: 'v2026.10.09', client_mode: 'browser', locale: 'zh-CN', errors: [FP],
  });
  const lobby = R.reportBody('idea', '', { ...CTX, worldId: null, edition: null, worldName: null, place: null, placeTitle: null, mode: 'local' });
  assert.deepEqual(lobby, { kind: 'idea', client_version: 'v2026.10.09', client_mode: 'local', locale: 'zh-CN' }, 'the lobby: no world, no place, no empty text');
  assert.equal(R.reportBody('bug', '', { ...CTX, edition: 'last-train' }).edition, undefined, 'same as the world id');
  assert.equal([...R.reportBody('bug', '字'.repeat(1200), CTX).text].length, R.REPORT_TEXT_MAX);
  assert.equal(R.reportBody('bug', '', { ...CTX, place: 'bad\nplace' }).place, undefined);
  assert.equal(R.reportBody('bug', '', CTX, ['c'.repeat(32), 'd'.repeat(32), 'e'.repeat(32), 'f'.repeat(32), '0'.repeat(32), '1'.repeat(32)]).errors.length, 5);
  assert.deepEqual(R.REPORT_KINDS, ['stuck', 'bug', 'idea']);
});

test('sendReport: sent (account / guest), signed_out, unavailable, rate_limited, refused; never throws', async () => {
  const answer = (status, body) => async (url, init) => {
    assert.equal(url, '/api/account-data/feedback');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['x-airp-settings'], '1');
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  assert.deepEqual(await R.sendReport({ kind: 'stuck' }, answer(200, { ok: true, available: true, sent: true, as: 'account' })), { status: 'sent', as: 'account' });
  assert.deepEqual(await R.sendReport({ kind: 'stuck' }, answer(200, { ok: true, available: true, sent: true, as: 'guest' })), { status: 'sent', as: 'guest' });
  assert.deepEqual(await R.sendReport({ kind: 'stuck' }, answer(200, { ok: false, available: false, reason: 'signed_out' })), { status: 'signed_out' });
  assert.deepEqual(await R.sendReport({ kind: 'stuck' }, answer(200, { ok: false, available: false, reason: 'not_allowed' })), { status: 'signed_out' });
  assert.deepEqual(await R.sendReport({ kind: 'stuck' }, answer(200, { ok: false, available: false, reason: 'unreachable' })), { status: 'unavailable' });
  assert.deepEqual(await R.sendReport({ kind: 'stuck' }, answer(429, { ok: false, available: true, code: 'rate_limited' })), { status: 'refused', code: 'rate_limited' });
  assert.deepEqual(await R.sendReport({ kind: 'stuck' }, answer(400, { ok: false, available: true, code: 'text_too_long' })), { status: 'refused', code: 'text_too_long' });
  assert.deepEqual(await R.sendReport({ kind: 'stuck' }, async () => { throw new TypeError('offline'); }), { status: 'unavailable' });
});

test('error codes = chronicle\'s fingerprint (kind \\0 message with digits → # \\0 top frame), recorded even with sending off', async () => {
  const chronicle = (p) => createHash('sha256').update(`${p.kind}\u0000${String(p.message).replace(/\d+/g, '#')}\u0000${p.stack?.[0] ?? ''}`).digest('hex').slice(0, 32);
  const e = { kind: 'error', message: 'Cannot read 3 of undefined', top: 'app.js:10:4' };
  assert.equal(await A.errorFingerprint(e), chronicle({ kind: 'error', message: e.message, stack: ['app.js:10:4'] }));
  A.clearRecentErrors();
  const c = A.createAnalytics({ endpoint: 'x', sessionId: 's'.repeat(16), appVersion: 'v', locale: () => 'zh', src: () => undefined, enabled: () => false, mode: () => 'off', directFallback: () => false, fetch: async () => new Response('{}'), sendBeacon: null });
  c.trackError({ kind: 'error', message: 'boom 1', stack: 'Error: boom\n    at f (http://x/app.js:1:2)' });
  c.trackError({ kind: 'error', message: 'boom 1', stack: 'Error: boom\n    at f (http://x/app.js:1:2)' });
  c.trackError({ kind: 'rejection', message: 'nope' });
  const fps = await A.recentErrorFingerprints();
  assert.equal(fps.length, 2, 'repeats folded');
  assert.ok(fps.every((f) => /^[a-f0-9]{32}$/.test(f)));
  for (let i = 0; i < 8; i++) c.trackError({ kind: 'error', message: `different ${'x'.repeat(i)}` });
  assert.equal((await A.recentErrorFingerprints()).length, 5, 'the newest five');
  A.clearRecentErrors();
});

test('two entries, one sheet: the world header (beside 联系我们) and the 联系我们 panel; the sheet is mounted once in App', async () => {
  const app = await src('../src/App.tsx');
  assert.match(app, /<ContactPanel focus=\{focusCoordinator\} \/>\s*\{\/\*[^*]*\*\/\}\s*<ReportIssueButton \/>/, 'beside 联系我们 in the world header');
  assert.equal(app.match(/<ReportIssueSheet /g)?.length, 1);
  assert.match(app, /reportContext: ReportContext = \{/);
  const panel = await src('../src/components/chrome/ContactPanel.tsx');
  assert.match(panel, /openReportIssue\(\)/);
  const sheet = await src('../src/components/chrome/ReportIssue.tsx');
  assert.match(sheet, /reportBody\(kind, text, context, errors\)/, 'the body is built only from the shown context');
  assert.doesNotMatch(sheet, /useWorld|messages|transcript|history/, 'no conversation source in the sheet');
  assert.match(sheet, /Your conversation with the characters is not included\./);
  // the thank-you promises what the console keeps: every report read, 3+ at one place first next week, fixes in 日志
  const messages = JSON.parse(await src('../src/lib/messages.json'));
  const thanks = messages['We read every report. When three or more players get stuck at the same place, fixing it is first on next week’s list; fixes are announced in the Logs.'];
  assert.match(thanks['zh-CN'], /3 个人以上，下周第一个修/);
  assert.match(thanks['zh-CN'], /日志/);
  for (const key of ["I'm stuck", 'Something broke', 'Suggestion', 'Report a problem', 'Report a problem / I’m stuck']) for (const l of ['zh-CN', 'ja', 'ko']) assert.ok(messages[key]?.[l], `${key} · ${l}`);
  assert.deepEqual([messages["I'm stuck"]['zh-CN'], messages['Something broke']['zh-CN'], messages.Suggestion['zh-CN']], ['卡住了', '出 bug 了', '建议']);
  // no new analytics event names (chronicle's list is closed)
  const analytics = await src('../src/lib/analytics.ts');
  assert.doesNotMatch(analytics.slice(analytics.indexOf('export const ANALYTICS_EVENTS'), analytics.indexOf('] as const;')), /report/);
});
