// -----------------------------------------------------------------------------
// A fake Bosch cloud for the tests: the Azure AD B2C token endpoint and the
// Indego API behind `fetch`, every call recorded, and a loud failure on an
// unexpected one. No test touches the network.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

/** 2026-10-17T10:00:00Z. */
export const FIXTURE_NOW = Date.parse('2026-10-17T10:00:00Z');

export const PELOUSE = '603100001';
export const VERGER = '603100002';

export const TOKEN = fixture('token.json');
export const RENEWED = fixture('token-renewed.json');

export const TOKEN_HOST = 'prodindego.b2clogin.com';
export const API_HOST = 'api.indego-cloud.iot.bosch-si.com';

export const json = (body, status = 200, headers = {}) =>
  new Response(body === undefined || body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const s256 = (verifier) => createHash('sha256').update(verifier).digest('base64url');

/**
 * The fake cloud. `state` (all optional, editable during a test):
 * - codes: authorization code -> the PKCE challenge it was issued for
 * - refreshTokens: refresh token -> token answer
 * - valid: the access tokens the API accepts
 * - mowers, generic (serial -> answer), states (serial -> answer),
 *   operating (serial -> answer), nextMow (serial -> answer or Response), alerts
 * - longpoll: serial -> the answer of the next long poll (consumed), else 504
 * - fail: path part -> Response or Error, answered instead (once if `failOnce`)
 * - slow: path part -> milliseconds the clock moves on during the call
 */
export function installIndego({ clock, ...overrides } = {}) {
  const state = {
    codes: new Map(),
    refreshTokens: new Map([
      [TOKEN.refresh_token, RENEWED],
      [RENEWED.refresh_token, RENEWED],
    ]),
    valid: new Set([TOKEN.access_token, RENEWED.access_token]),
    mowers: fixture('alms.json'),
    generic: new Map([
      [PELOUSE, fixture('generic.json')],
      [VERGER, fixture('generic-old.json')],
    ]),
    states: new Map([
      [PELOUSE, fixture('state-docked.json')],
      [VERGER, fixture('state-docked.json')],
    ]),
    operating: new Map([
      [PELOUSE, fixture('operating.json')],
      [VERGER, { battery: { percent: 340 } }],
    ]),
    nextMow: new Map([[PELOUSE, fixture('nextcutting.json')]]),
    alerts: fixture('alerts.json'),
    longpoll: new Map(),
    commands: [],
    fail: new Map(),
    slow: new Map(),
    ...overrides,
  };
  const calls = [];
  const previous = setFetch(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const parsed = new URL(url);
    const path = parsed.pathname;
    let body = init.body;
    if (typeof body === 'string') {
      body = init.headers?.['Content-Type']?.includes('form')
        ? Object.fromEntries(new URLSearchParams(body))
        : JSON.parse(body);
    }
    const call = {
      url,
      host: parsed.host,
      path,
      query: Object.fromEntries(parsed.searchParams),
      method,
      headers: init.headers ?? {},
      body,
    };
    calls.push(call);
    for (const [part, ms] of state.slow) {
      if (url.includes(part) && clock) {
        clock.now += ms;
      }
    }
    for (const [part, answer] of state.fail) {
      if (url.includes(part)) {
        if (state.failOnce) {
          state.fail.delete(part);
        }
        if (answer instanceof Error) {
          throw answer;
        }
        return typeof answer === 'function' ? answer(call) : answer.clone();
      }
    }
    if (parsed.host === TOKEN_HOST && method === 'POST' && path.endsWith('/oauth2/v2.0/token')) {
      if (body.client_id !== '65bb8c9d-1070-4fb4-aa95-853618acc876' || body.client_secret) {
        return json({ error: 'invalid_client' }, 401);
      }
      if (body.grant_type === 'authorization_code') {
        const challenge = state.codes.get(body.code);
        if (
          challenge &&
          s256(body.code_verifier ?? '') === challenge &&
          body.redirect_uri === 'com.bosch.indegoconnect://login'
        ) {
          state.codes.delete(body.code);
          return json(state.token ?? TOKEN);
        }
        return json(fixture('invalid-grant.json'), 400);
      }
      if (body.grant_type === 'refresh_token' && state.refreshTokens.has(body.refresh_token)) {
        return json(state.refreshTokens.get(body.refresh_token));
      }
      return json(fixture('invalid-grant.json'), 400);
    }
    if (parsed.host !== API_HOST) {
      throw new Error(`Unexpected host in a test: ${url}`);
    }
    const auth = call.headers.Authorization ?? '';
    if (!state.valid.has(auth.replace(/^Bearer /, ''))) {
      return json({ message: 'Unauthorized' }, 401);
    }
    const route = path.replace(/^\/api\/v1\//, '');
    let match;
    if (method === 'GET' && route === 'alms') {
      return json(state.mowers);
    }
    if (method === 'GET' && route === 'alerts') {
      return json(state.alerts);
    }
    if ((match = /^alms\/([^/]+)$/.exec(route)) && method === 'GET') {
      const answer = state.generic.get(match[1]);
      return answer ? json(answer) : json({ message: 'not found' }, 404);
    }
    if ((match = /^alms\/([^/]+)\/state$/.exec(route))) {
      const serial = match[1];
      if (method === 'PUT') {
        state.commands.push({ serial, command: body?.state });
        return new Response(null, { status: 200 });
      }
      if (call.query.longpoll === 'true') {
        if (state.longpoll.has(serial)) {
          const answer = state.longpoll.get(serial);
          state.longpoll.delete(serial);
          return json(answer);
        }
        return new Response('Gateway Timeout', { status: 504 });
      }
      return json(state.states.get(serial));
    }
    if ((match = /^alms\/([^/]+)\/operatingData$/.exec(route))) {
      return json(state.operating.get(match[1]) ?? {});
    }
    if ((match = /^alms\/([^/]+)\/predictive\/nextcutting$/.exec(route))) {
      const answer = state.nextMow.get(match[1]);
      if (answer instanceof Response) {
        return answer.clone();
      }
      return answer ? json(answer) : new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected network call in a test: ${method} ${url}`);
  });
  return {
    state,
    calls,
    /** The calls whose URL contains `part`. */
    to: (part) => calls.filter((c) => c.url.includes(part)),
    api: () => calls.filter((c) => c.host === API_HOST),
    /** Issue an authorization code for the challenge of a sign-in address. */
    issueCode(authorizeUrl, code = 'auth-code-1') {
      const challenge = new URL(authorizeUrl).searchParams.get('code_challenge');
      state.codes.set(code, challenge);
      return code;
    },
    restore: () => setFetch(previous),
  };
}
