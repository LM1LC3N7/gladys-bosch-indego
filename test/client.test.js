// -----------------------------------------------------------------------------
// The Indego API client: paths, headers, the long poll, and how every
// answer is classified (renewal on 401, gateway 403, 429, 5xx).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { USER_AGENT } from '../src/constants.js';
import { IndegoAuth, tokenOf } from '../src/indego/auth.js';
import { IndegoClient } from '../src/indego/client.js';
import { parseRetryAfter, reasonOf } from '../src/indego/errors.js';
import { HttpError, MAX_BODY, request } from '../src/http.js';
import {
  FIXTURE_NOW,
  PELOUSE,
  RENEWED,
  TOKEN,
  VERGER,
  fixture,
  installIndego,
  json,
} from './helpers/fakeIndego.js';

let fake;
afterEach(() => fake?.restore());

function setup(overrides = {}) {
  const clock = { now: FIXTURE_NOW };
  fake = installIndego({ clock, ...overrides });
  const auth = new IndegoAuth({ now: () => clock.now });
  auth.load(tokenOf(TOKEN, FIXTURE_NOW));
  const client = new IndegoClient({ auth, now: () => clock.now });
  return { auth, client, clock };
}

test('reads: mowers, generic, state, battery, next mowing, alerts', async () => {
  const { client } = setup();
  assert.deepEqual(await client.mowers(), [{ serial: PELOUSE }, { serial: VERGER }]);
  assert.equal((await client.generic(PELOUSE)).alm_name, 'Pelouse');
  assert.equal((await client.state(PELOUSE)).state, 64513);
  assert.equal((await client.operating(PELOUSE)).battery.percent, 86);
  assert.deepEqual(await client.nextMow(PELOUSE), fixture('nextcutting.json'));
  assert.equal(await client.nextMow(VERGER), null, '204: no SmartMowing');
  assert.equal((await client.alerts()).length, 2);
  for (const call of fake.calls) {
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN.access_token}`);
    assert.equal(call.headers['User-Agent'], USER_AGENT);
    assert.equal(call.method, 'GET');
  }
  assert.deepEqual(
    fake.calls.map((c) => c.path),
    [
      '/api/v1/alms',
      `/api/v1/alms/${PELOUSE}`,
      `/api/v1/alms/${PELOUSE}/state`,
      `/api/v1/alms/${PELOUSE}/operatingData`,
      `/api/v1/alms/${PELOUSE}/predictive/nextcutting`,
      `/api/v1/alms/${VERGER}/predictive/nextcutting`,
      '/api/v1/alerts',
    ],
  );
});

test('the long poll: last state, 230 s, and a 504 that means "no change"', async () => {
  const { client } = setup();
  assert.equal(await client.state(PELOUSE, { longpoll: true, last: 64513 }), null);
  const [call] = fake.calls;
  assert.deepEqual(call.query, { longpoll: 'true', timeout: '230', last: '64513' });
  fake.state.longpoll.set(PELOUSE, { state: 513 });
  assert.deepEqual(await client.state(PELOUSE, { longpoll: true, last: 64513 }), { state: 513 });
  // A 504 of a plain read is a failure.
  fake.state.fail.set('/state', new Response('Gateway Timeout', { status: 504 }));
  await assert.rejects(client.state(PELOUSE), { code: 'unreachable' });
});

test('a command: PUT state with the current token only', async () => {
  const { client, auth, clock } = setup();
  assert.equal(await client.command(PELOUSE, 'returnToDock', { timeout: 2000 }), null);
  assert.deepEqual(fake.state.commands, [{ serial: PELOUSE, command: 'returnToDock' }]);
  assert.equal(fake.calls[0].method, 'PUT');
  assert.deepEqual(fake.calls[0].body, { state: 'returnToDock' });
  // An expiring token is not renewed by a command (no time for it).
  clock.now = auth.token.expiresAt - 1000;
  await client.command(PELOUSE, 'mow', { timeout: 2000 });
  assert.equal(fake.to('/token').length, 0);
});

test('a 401 renews the token once and tries again once; never in a loop', async () => {
  const { client, auth } = setup();
  fake.state.valid = new Set([RENEWED.access_token]);
  assert.equal((await client.state(PELOUSE)).state, 64513);
  assert.equal(auth.token.accessToken, RENEWED.access_token);
  assert.equal(fake.to('/token').length, 1);
  // The new token is refused too: no new renewal within 10 minutes.
  fake.state.valid = new Set();
  await assert.rejects(client.state(PELOUSE), { code: 'unauthorized' });
  await assert.rejects(client.state(PELOUSE), { code: 'unauthorized' });
  assert.equal(fake.to('/token').length, 1);
});

test('a 401 whose renewal is refused: the session is over', async () => {
  const { client, auth } = setup();
  fake.state.valid = new Set();
  fake.state.refreshTokens.clear();
  await assert.rejects(client.alerts(), { code: 'refused' });
  assert.equal(auth.refused, true);
});

test('403 gateway, 429 with Retry-After, 5xx, 404, network: each its code', async () => {
  const { client } = setup();
  const cases = [
    [new Response('<html><title>403 Forbidden</title></html>', { status: 403 }), 'blocked'],
    [json({ message: 'slow' }, 429, { 'retry-after': '90' }), 'rate_limited'],
    [json({ message: 'down' }, 503), 'unreachable'],
    [json({ message: 'nope' }, 404), 'api'],
    [new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }), 'unreachable'],
    [new DOMException('The operation timed out.', 'TimeoutError'), 'unreachable'],
  ];
  for (const [answer, code] of cases) {
    fake.state.fail.set('/alerts', answer);
    const err = await client.alerts().catch((e) => e);
    assert.equal(err.code, code, String(code));
    assert.doesNotMatch(err.message, /Bearer|access-token/);
    if (code === 'rate_limited') {
      assert.equal(err.retryAfter, 90_000);
    }
  }
  fake.state.fail.set('nextcutting', json({ message: 'no smart mowing' }, 404));
  assert.equal(await client.nextMow(PELOUSE), null);
});

test('Retry-After: seconds, a date, junk', () => {
  assert.equal(parseRetryAfter('30', 0), 30_000);
  assert.equal(parseRetryAfter(new Date(60_000).toUTCString(), 0), 60_000);
  assert.equal(parseRetryAfter('soon', 0), undefined);
  assert.equal(parseRetryAfter(undefined, 0), undefined);
});

test('http: a bounded read, errors without query nor headers', async () => {
  fake = installIndego();
  fake.state.fail.set('big', new Response('x'.repeat(MAX_BODY + 10_000), { status: 200 }));
  const answer = await request('https://api.indego-cloud.iot.bosch-si.com/big');
  assert.equal(answer.data.length, MAX_BODY);
  fake.state.fail.set('bad', json({ error: 'x' }, 500));
  const err = await request('https://api.indego-cloud.iot.bosch-si.com/bad?code=secret').catch(
    (e) => e,
  );
  assert.ok(err instanceof HttpError);
  assert.doesNotMatch(err.message, /secret/);
  assert.equal(reasonOf(err), 'HTTP 500 on /bad: x');
});
