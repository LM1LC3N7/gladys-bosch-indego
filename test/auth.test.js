// -----------------------------------------------------------------------------
// The Bosch SingleKey ID sign-in: PKCE, the pasted address, the code
// exchange, the renewal and its pacing.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { OAUTH, SIGN_IN_TTL, TOKEN_MARGIN, TOKEN_RETRY } from '../src/constants.js';
import {
  IndegoAuth,
  parseRedirect,
  pkcePair,
  tokenFromStore,
  tokenOf,
  tokenToStore,
} from '../src/indego/auth.js';
import { FIXTURE_NOW, RENEWED, TOKEN, installIndego, json } from './helpers/fakeIndego.js';

let fake;
afterEach(() => fake?.restore());

const setup = (overrides = {}) => {
  const clock = { now: FIXTURE_NOW };
  fake = installIndego({ clock, ...overrides });
  const stored = [];
  const auth = new IndegoAuth({
    now: () => clock.now,
    onToken: async (token, reason) => stored.push({ token, reason }),
  });
  return { auth, clock, stored };
};

const redirect = (state, code) => `com.bosch.indegoconnect://login?state=${state}&code=${code}`;

test('PKCE: an S256 challenge of a long random verifier', () => {
  const { verifier, challenge } = pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  assert.notEqual(pkcePair().verifier, verifier);
});

test('the sign-in address: the app client, its redirect, the scopes, a state and a challenge', () => {
  const { auth } = setup();
  const url = new URL(auth.beginSignIn());
  assert.equal(`${url.origin}${url.pathname}`, OAUTH.AUTHORIZE_URL);
  const p = url.searchParams;
  assert.equal(p.get('client_id'), OAUTH.CLIENT_ID);
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('response_mode'), 'query');
  assert.equal(p.get('redirect_uri'), 'com.bosch.indegoconnect://login');
  assert.match(p.get('scope'), /offline_access/);
  assert.match(p.get('scope'), /Indego\.Mower\.User/);
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.match(p.get('state'), /^[A-Za-z0-9_-]{16,}$/);
  assert.notEqual(new URL(auth.beginSignIn()).searchParams.get('state'), p.get('state'));
});

test('the pasted address: the plain one, the console line, the encoded HTML, a bare code', () => {
  assert.deepEqual(parseRedirect(redirect('st1', 'c0de')), {
    code: 'c0de',
    state: 'st1',
    error: null,
    errorDescription: null,
  });
  const line =
    "Failed to launch 'com.bosch.indegoconnect://login?state=st2&code=abc.def-ghi' because the scheme does not have a registered handler.";
  assert.equal(parseRedirect(line).code, 'abc.def-ghi');
  assert.equal(parseRedirect(line).state, 'st2');
  const html =
    '<a href="com.bosch.indegoconnect%3a%2f%2flogin%3fstate%3dst3%26code%3dxyz">here</a>';
  assert.deepEqual([parseRedirect(html).state, parseRedirect(html).code], ['st3', 'xyz']);
  assert.equal(parseRedirect('?state=a&amp;code=b').code, 'b');
  assert.equal(parseRedirect('state=a&code=b').state, 'a');
  // A bare code: a B2C code (base64url JWE, "eyJ…"), 4096 characters at most.
  const bare = `eyJ${'k'.repeat(40)}`;
  assert.equal(parseRedirect(`  ${bare}  `).code, bare);
  assert.equal(parseRedirect('k'.repeat(40)), null);
  assert.equal(parseRedirect(`eyJ${'k'.repeat(4100)}`), null);
  // Decoded once only: an encoded value inside stays what Bosch sent.
  const twice = 'com.bosch.indegoconnect%3a%2f%2flogin%3fstate%3dst4%26code%3da%252Bb';
  assert.equal(parseRedirect(twice).code, 'a+b');
  // An address that is not the app's redirect is refused, even with a code.
  for (const other of [
    'https://example.com/?code=abc&state=x',
    'https://prodindego.b2clogin.com/prodindego.onmicrosoft.com/oauth2/authresp?code=abc',
    'com.bosch.indegoconnect://other?code=abc',
  ]) {
    assert.equal(parseRedirect(other), null, other);
  }
  // Cut by the console.
  for (const cut of [
    "Failed to launch 'com.bosch.indegoconnect://login?state=s&code=eyJhbGci…'",
    'com.bosch.indegoconnect://login?state=s&code=eyJhbGci...',
  ]) {
    assert.equal(parseRedirect(cut).truncated, true);
  }
  const denied = parseRedirect(
    'com.bosch.indegoconnect://login?error=access_denied&error_description=AADB2C90091%3a+cancelled&state=s',
  );
  assert.equal(denied.error, 'access_denied');
  assert.match(denied.errorDescription, /cancelled/);
  for (const junk of ['', '   ', 'hello', 'https://example.com/?foo=bar', null, undefined]) {
    assert.equal(parseRedirect(junk), null, String(junk));
  }
});

test('finishing the sign-in: the code is exchanged with the verifier of its state', async () => {
  const { auth, stored } = setup();
  const url = auth.beginSignIn();
  const state = new URL(url).searchParams.get('state');
  const code = fake.issueCode(url);
  const token = await auth.finishSignIn(redirect(state, code));
  assert.equal(token.accessToken, TOKEN.access_token);
  assert.equal(token.refreshToken, TOKEN.refresh_token);
  assert.equal(token.expiresAt, FIXTURE_NOW + 3600_000);
  assert.equal(token.refreshExpiresAt, FIXTURE_NOW + 1_209_600_000);
  assert.deepEqual(
    stored.map((s) => s.reason),
    ['sign_in'],
  );
  const [call] = fake.to('/oauth2/v2.0/token');
  assert.equal(call.method, 'POST');
  assert.equal(call.body.grant_type, 'authorization_code');
  assert.equal(call.body.client_id, OAUTH.CLIENT_ID);
  assert.equal(call.body.client_secret, undefined, 'a public client: no secret');
  assert.equal(call.body.scope, OAUTH.SCOPE);
  // The verifier serves once.
  await assert.rejects(auth.finishSignIn(redirect(state, code)), { code: 'sign_in' });
});

test('a pasted address of another, an old or no sign-in is refused before any call', async () => {
  const { auth, clock } = setup();
  await assert.rejects(auth.finishSignIn(redirect('unknown', 'c')), { code: 'sign_in' });
  const url = auth.beginSignIn();
  const state = new URL(url).searchParams.get('state');
  clock.now += SIGN_IN_TTL + 1;
  await assert.rejects(auth.finishSignIn(redirect(state, fake.issueCode(url))), {
    code: 'sign_in',
  });
  await assert.rejects(auth.finishSignIn('nothing here'), { code: 'sign_in' });
  assert.equal(fake.calls.length, 0);
  // Without a state: the newest sign-in.
  const url2 = auth.beginSignIn();
  const token = await auth.finishSignIn(`code=${fake.issueCode(url2, 'c2')}`);
  assert.equal(token.accessToken, TOKEN.access_token);
});

test('only five sign-ins are kept', () => {
  const { auth } = setup();
  const states = Array.from({ length: 7 }, () =>
    new URL(auth.beginSignIn()).searchParams.get('state'),
  );
  assert.equal(auth.pending.size, 5);
  assert.ok(!auth.pending.has(states[0]) && auth.pending.has(states[6]));
});

test('a refused code, a refusal in the address, a 429 and a network failure', async () => {
  const { auth } = setup();
  const url = auth.beginSignIn();
  const state = new URL(url).searchParams.get('state');
  await assert.rejects(auth.finishSignIn(redirect(state, 'wrong-code')), (err) => {
    assert.equal(err.code, 'refused');
    assert.match(err.message, /invalid_grant: AADB2C90080/);
    assert.doesNotMatch(err.message, /Correlation/);
    return true;
  });
  await assert.rejects(
    auth.finishSignIn('com.bosch.indegoconnect://login?error=access_denied&state=x'),
    { code: 'refused' },
  );
  for (const [answer, code] of [
    [json({ error: 'slow down' }, 429, { 'retry-after': '120' }), 'rate_limited'],
    [new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }), 'unreachable'],
    [new Response('<html><title>502 Bad Gateway</title></html>', { status: 502 }), 'unreachable'],
  ]) {
    fake.state.fail.set('/token', answer);
    const u = auth.beginSignIn();
    const err = await auth
      .finishSignIn(redirect(new URL(u).searchParams.get('state'), fake.issueCode(u)))
      .catch((e) => e);
    assert.equal(err.code, code);
    if (code === 'rate_limited') {
      assert.equal(err.retryAfter, 120_000);
    }
  }
});

test('renewal: before expiry, the new refresh token kept, the old one when none comes', async () => {
  const { auth, clock, stored } = setup();
  auth.load(tokenOf(TOKEN, FIXTURE_NOW));
  await auth.renewIfDue();
  assert.equal(fake.calls.length, 0, 'not due yet');
  clock.now = FIXTURE_NOW + 3600_000 - TOKEN_MARGIN;
  assert.equal(await auth.accessToken(), RENEWED.access_token);
  assert.equal(auth.token.refreshToken, RENEWED.refresh_token);
  assert.equal(stored.at(-1).reason, 'renew');
  const [call] = fake.to('/token');
  assert.equal(call.body.grant_type, 'refresh_token');
  assert.equal(call.body.refresh_token, TOKEN.refresh_token);

  // An answer without a refresh token keeps the previous one.
  fake.state.refreshTokens.set(RENEWED.refresh_token, { access_token: 'a3', expires_in: 3600 });
  await auth.renew();
  assert.equal(auth.token.accessToken, 'a3');
  assert.equal(auth.token.refreshToken, RENEWED.refresh_token);
});

test('a refused renewal stops for good; a failed one waits 1, 5, 15, 60 min', async () => {
  const { auth, clock } = setup();
  auth.load(tokenOf(TOKEN, FIXTURE_NOW));
  clock.now = FIXTURE_NOW + 2 * 3600_000;
  fake.state.fail.set('/token', new TypeError('fetch failed'));
  await auth.renewIfDue();
  assert.equal(auth.retryAt, clock.now + TOKEN_RETRY[0]);
  await auth.renewIfDue();
  assert.equal(fake.to('/token').length, 1, 'no new try before the delay');
  await assert.rejects(auth.accessToken(), { code: 'unreachable' });
  clock.now = auth.retryAt;
  await auth.renewIfDue();
  assert.equal(auth.retryAt, clock.now + TOKEN_RETRY[1]);

  fake.state.fail.clear();
  fake.state.refreshTokens.clear();
  clock.now = auth.retryAt;
  await assert.rejects(auth.renewIfDue(), { code: 'refused' });
  const calls = fake.to('/token').length;
  await assert.rejects(auth.accessToken(), { code: 'refused' });
  await assert.rejects(auth.renewIfDue(), { code: 'refused' });
  assert.equal(fake.to('/token').length, calls, 'a refused refresh token is never tried again');
});

test('a sign-in without a renewal token is refused, never patched with the old one', async () => {
  const { auth } = setup();
  auth.load(tokenOf(TOKEN, FIXTURE_NOW));
  fake.state.token = { access_token: 'only-access', expires_in: 3600 };
  const url = auth.beginSignIn();
  const err = await auth
    .finishSignIn(redirect(new URL(url).searchParams.get('state'), fake.issueCode(url)))
    .catch((e) => e);
  assert.equal(err.code, 'refused');
  assert.equal(err.detail, 'no renewal token in the answer');
  assert.equal(auth.token.accessToken, TOKEN.access_token, 'the previous session is untouched');
});

test('a renewal still running when a sign-in finishes is dropped', async () => {
  const { auth, clock } = setup();
  auth.load(tokenOf(TOKEN, FIXTURE_NOW));
  clock.now += 2 * 3600_000;
  let release;
  fake.state.fail.set('/token', (call) => {
    if (call.body.grant_type === 'refresh_token') {
      return new Promise((resolve) => {
        release = () => resolve(json({ error: 'invalid_grant' }, 400));
      });
    }
    fake.state.fail.delete('/token');
    return json(RENEWED);
  });
  const renewing = auth.renew();
  await new Promise((resolve) => setImmediate(resolve));
  const url = auth.beginSignIn();
  fake.state.codes.set('c3', new URL(url).searchParams.get('code_challenge'));
  // The sign-in answer comes from the fail handler (RENEWED).
  await auth.finishSignIn(redirect(new URL(url).searchParams.get('state'), 'c3'));
  release();
  await renewing;
  assert.equal(auth.refused, false, 'the refusal of the old session is ignored');
  assert.equal(auth.token.refreshToken, RENEWED.refresh_token);
});

test('the stored token: round trip, and junk ignored', () => {
  const token = tokenOf(TOKEN, FIXTURE_NOW);
  assert.deepEqual(tokenFromStore(tokenToStore(token)), token);
  assert.deepEqual(tokenFromStore(JSON.stringify(tokenToStore(token))), token);
  for (const junk of [null, undefined, '', '{', 42, {}, { access_token: 'a' }]) {
    assert.equal(tokenFromStore(junk), null);
  }
  assert.equal(tokenOf({}, 0), null);
  assert.equal(tokenOf({ access_token: 'a' }, 0).expiresAt, 3600_000);
});
