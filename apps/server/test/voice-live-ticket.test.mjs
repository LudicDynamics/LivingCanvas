// The call ticket (voice-live-ticket.ts): the server asks ai.worldlines.gg for
// a one-use ticket with the account's token, and the page gets only the ticket
// and where to use it. Fake fetch only — no ai, no account service.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from '../../../vendor/pi-rp/node_modules/jiti/lib/jiti.mjs';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { requestVoiceTicket, gatewayAccessToken, voiceTicketsUrl, VOICE_PROTOCOL } = await jiti.import('../src/engine/voice-live-ticket.ts');

const TICKET = 'tkt_0123456789abcdefABCDEF';
const TICKETS_URL = 'https://ai.example.test/v1/voice/tickets';

function fakeAi(status, body) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, request };
}

test('a ticket comes back as a direct call: the cast in the URL, the ticket in the subprotocols only', async () => {
  const ai = fakeAi(201, { ticket: TICKET, url: 'wss://ai.example.test/v1/voice/live', expires_in: 60, remaining_seconds: 1200 });
  const answer = await requestVoiceTicket({
    ticketsUrl: TICKETS_URL, accessToken: 'jwt-of-the-account', request: ai.request,
    cast: { character: 'vera', voice: 'Cherry', language: 'English' },
  });
  assert.deepEqual(answer, {
    mode: 'direct',
    url: 'wss://ai.example.test/v1/voice/live?character=vera&brain=relay&voice=Cherry&language=English',
    protocols: [VOICE_PROTOCOL, `ticket.${TICKET}`],
    expiresIn: 60,
    remainingSeconds: 1200,
  });
  assert.ok(!answer.url.includes(TICKET), 'the ticket never rides the URL (access logs)');
  const [call] = ai.calls;
  assert.equal(call.url, TICKETS_URL);
  assert.equal(call.init.headers.authorization, 'Bearer jwt-of-the-account');
  assert.equal(call.init.headers['x-worldlines-product'], 'livingcanvas');
  assert.equal(call.init.redirect, 'error', 'the account token never follows a redirect');
  assert.deepEqual(call.body, { character: 'vera' });
});

test('the account’s own refusals reach the page with their code; anything else is a 502', async () => {
  const out = await requestVoiceTicket({ ticketsUrl: TICKETS_URL, accessToken: 't', cast: {}, request: fakeAi(402, { error: { code: 'insufficient_credits', message: 'No minutes left.' } }).request });
  assert.deepEqual(out, { mode: 'error', status: 402, code: 'insufficient_credits', message: 'No minutes left.' });
  const busy = await requestVoiceTicket({ ticketsUrl: TICKETS_URL, accessToken: 't', cast: {}, request: fakeAi(503, { error: { code: 'voice_busy' } }).request });
  assert.equal(busy.status, 502);
  assert.equal(busy.code, 'voice_busy');
  const down = await requestVoiceTicket({ ticketsUrl: TICKETS_URL, accessToken: 't', cast: {}, request: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(down.code, 'ticket_unreachable');
});

test('out of minutes: the billing link and the reset date reach the page; a non-https link does not', async () => {
  const out = await requestVoiceTicket({ ticketsUrl: TICKETS_URL, accessToken: 't', cast: {}, request: fakeAi(429, { error: {
    code: 'quota_exceeded', message: 'used up', resets_at: '2026-11-01T00:00:00.000Z', billing_url: 'https://worldlines.gg/billing?reason=quota',
  } }).request });
  assert.deepEqual(out, {
    mode: 'error', status: 429, code: 'quota_exceeded', message: 'used up',
    billingUrl: 'https://worldlines.gg/billing?reason=quota', resetsAt: '2026-11-01T00:00:00.000Z',
  });
  const plan = await requestVoiceTicket({ ticketsUrl: TICKETS_URL, accessToken: 't', cast: {}, request: fakeAi(403, { error: {
    code: 'plan_required', billing_url: 'javascript:alert(1)',
  } }).request });
  assert.equal(plan.code, 'plan_required');
  assert.equal(plan.billingUrl, undefined);
});

test('an unusable answer is refused, never passed on: bad ticket, or a socket URL that is not wss', async () => {
  for (const body of [
    { ticket: 'short', url: 'wss://ai.example.test/v1/voice/live' },
    { ticket: 'has spaces and; semicolons ok?', url: 'wss://ai.example.test/v1/voice/live' },
    { ticket: TICKET, url: 'ws://ai.example.test/v1/voice/live' },
    { ticket: TICKET, url: 'wss://ai.example.test' },
  ]) {
    const out = await requestVoiceTicket({ ticketsUrl: TICKETS_URL, accessToken: 't', cast: {}, request: fakeAi(201, body).request });
    assert.equal(out.code, 'ticket_malformed', JSON.stringify(body));
  }
});

test('the gateway’s token is trusted only with the seats’ own secret, never from a client alone', () => {
  const env = { AIRP_SEAT_ACCESS_SECRET: 'seat-secret-0123456789' };
  const req = (headers) => ({ headers });
  assert.equal(gatewayAccessToken(req({ 'x-airp-access-token': 'jwt' }), env), null);
  assert.equal(gatewayAccessToken(req({ 'x-airp-access-token': 'jwt', 'x-airp-seat-secret': 'wrong-secret-0123456' }), env), null);
  assert.equal(gatewayAccessToken(req({ 'x-airp-access-token': 'jwt', 'x-airp-seat-secret': 'seat-secret-0123456789' }), env), 'jwt');
  assert.equal(gatewayAccessToken(req({ 'x-airp-access-token': 'jwt', 'x-airp-seat-secret': 'short' }), { AIRP_SEAT_ACCESS_SECRET: 'short' }), null, 'a short secret disables it');
  assert.equal(gatewayAccessToken(req({ 'x-airp-access-token': 'jwt', 'x-airp-gateway-secret': 'seat-secret-0123456789' }), env), null, 'the sync secret header is not this one');
});

test('no tickets URL configured: the page keeps the proxied call', () => {
  assert.equal(voiceTicketsUrl({}), '');
  assert.equal(voiceTicketsUrl({ VOICE_LIVE_TICKETS_URL: ` ${TICKETS_URL} ` }), TICKETS_URL);
});
