// -----------------------------------------------------------------------------
// The Bosch SingleKey ID account: the OAuth2 authorization-code flow with
// PKCE of the Bosch Indego app (Azure AD B2C, public client), the token kept
// with its expiry, and its renewal.
//
// The client only knows the app's redirect, `com.bosch.indegoconnect://login`,
// that no browser can open (sander1988/Indego ships a browser extension for
// it). So the sign-in runs in two steps without any extension:
//   1. beginSignIn(): a sign-in address with a fresh `state` and PKCE
//      challenge, opened by the user (Connect button or the start action);
//   2. finishSignIn(text): the user pastes the address the sign-in ended on
//      (`com.bosch.indegoconnect://login?state=…&code=…`, copied from the
//      browser console or network tab); its code is exchanged with the
//      verifier of that `state`.
// The token endpoint answers the standard OAuth2 JSON (access_token,
// refresh_token, expires_in, refresh_token_expires_in); a refused code or
// refresh token is HTTP 400 {"error":"invalid_grant"} (Azure AD B2C
// documentation, not checked on a real account). This file never logs a
// token, a code or a verifier.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import {
  HTTP_TIMEOUT,
  OAUTH,
  SIGN_IN_MAX,
  SIGN_IN_TTL,
  TOKEN_MARGIN,
  TOKEN_RETRY,
} from '../constants.js';
import { HttpError, request } from '../http.js';
import { IndegoError, parseRetryAfter, reasonOf } from './errors.js';

const base64url = (buffer) => buffer.toString('base64url');

/** A PKCE pair (RFC 7636, S256). */
export function pkcePair() {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * The parameters of the pasted address: { code, state, error, errorDescription },
 * or null when nothing usable is in it. Takes the address itself, the whole
 * console line around it ("Failed to launch 'com.bosch.indegoconnect://…'"),
 * its percent-encoded form (from the HTML of the last page), or a bare code.
 */
export function parseRedirect(input) {
  let text = String(input ?? '')
    .trim()
    .slice(0, 8192);
  if (!text) {
    return null;
  }
  if (/indegoconnect%3a/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      return null;
    }
  }
  text = text.replace(/&amp;/g, '&');
  if (/^(?:code|state|error)=/.test(text)) {
    // Only the query string was copied.
    text = `?${text}`;
  }
  const at = text.search(/[?&#](?:code|error)=/);
  if (at === -1) {
    // A bare authorization code (long, URL-safe).
    return /^[A-Za-z0-9._~-]{20,}$/.test(text) ? { code: text, state: null, error: null } : null;
  }
  const start = text.lastIndexOf('?', at) === -1 ? at : text.lastIndexOf('?', at);
  const query = text
    .slice(start + 1)
    .split(/[\s'"<>]/)[0]
    .replace(/#/g, '&');
  const params = new URLSearchParams(query);
  const result = {
    code: params.get('code') || null,
    state: params.get('state') || null,
    error: params.get('error') || null,
    errorDescription: params.get('error_description') || null,
  };
  return result.code || result.error ? result : null;
}

/** The token answer -> the token kept, or null without an access token. */
export function tokenOf(data, now) {
  if (!data || typeof data.access_token !== 'string' || !data.access_token) {
    return null;
  }
  const expiresIn = Number(data.expires_in);
  const refreshIn = Number(data.refresh_token_expires_in);
  return {
    accessToken: data.access_token,
    refreshToken:
      typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : null,
    // Without an expiry, an hour: a refused call renews it earlier anyway.
    expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
    refreshExpiresAt: Number.isFinite(refreshIn) && refreshIn > 0 ? now + refreshIn * 1000 : null,
    obtainedAt: now,
  };
}

/** The stored form of a token (a config value) -> the token, or null. */
export function tokenFromStore(value) {
  let token = value;
  if (typeof token === 'string') {
    try {
      token = JSON.parse(token);
    } catch {
      return null;
    }
  }
  if (!token || typeof token !== 'object' || typeof token.refresh_token !== 'string') {
    return null;
  }
  return {
    accessToken: typeof token.access_token === 'string' ? token.access_token : null,
    refreshToken: token.refresh_token,
    expiresAt: Number(token.expires_at) || 0,
    refreshExpiresAt: Number(token.refresh_expires_at) || null,
    obtainedAt: Number(token.obtained_at) || 0,
  };
}

/** The token -> its stored form (snake_case keys, epoch milliseconds). */
export const tokenToStore = (token) => ({
  access_token: token.accessToken,
  refresh_token: token.refreshToken,
  expires_at: token.expiresAt,
  refresh_expires_at: token.refreshExpiresAt,
  obtained_at: token.obtainedAt,
});

export class IndegoAuth {
  constructor({ tokenUrl = OAUTH.TOKEN_URL, now = Date.now, onToken = async () => {} } = {}) {
    this.tokenUrl = tokenUrl;
    this.now = now;
    /** Called with every new token, to store it. */
    this.onToken = onToken;
    this.token = null;
    /** The sign-ins started: state -> { verifier, at }. */
    this.pending = new Map();
    /** Set when Bosch refused the refresh token: a new sign-in is needed. */
    this.refused = false;
    this.renewing = undefined;
    /** Failed renewals in a row (network), when to try again, and why it failed. */
    this.failures = 0;
    this.retryAt = 0;
    this.lastFailure = undefined;
  }

  get signedIn() {
    return Boolean(this.token?.refreshToken);
  }

  /** Take a stored token (at start, or when Gladys sends the config back). */
  load(token) {
    if (!token) {
      return;
    }
    // A token we renewed since is newer than the one Gladys sends back.
    if (!this.token || token.obtainedAt > this.token.obtainedAt) {
      this.token = token;
      this.refused = false;
    }
  }

  // --- Sign-in ----------------------------------------------------------------------

  /** A sign-in address with a fresh state and PKCE challenge (its verifier kept 15 minutes). */
  beginSignIn() {
    const now = this.now();
    for (const [state, entry] of this.pending) {
      if (now - entry.at > SIGN_IN_TTL) {
        this.pending.delete(state);
      }
    }
    while (this.pending.size >= SIGN_IN_MAX) {
      this.pending.delete(this.pending.keys().next().value);
    }
    const state = base64url(randomBytes(16));
    const { verifier, challenge } = pkcePair();
    this.pending.set(state, { verifier, at: now });
    const url = new URL(OAUTH.AUTHORIZE_URL);
    url.searchParams.set('client_id', OAUTH.CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('redirect_uri', OAUTH.REDIRECT_URI);
    url.searchParams.set('scope', OAUTH.SCOPE);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /** The verifier of a pasted state (or of the newest sign-in when the address has none). It serves once. */
  takeVerifier(state) {
    const now = this.now();
    let key = state;
    if (!key) {
      key = [...this.pending.keys()].at(-1);
    }
    const entry = key ? this.pending.get(key) : undefined;
    if (!entry) {
      return null;
    }
    this.pending.delete(key);
    return now - entry.at <= SIGN_IN_TTL ? entry.verifier : null;
  }

  /** The address the sign-in ended on (pasted) -> a new token, stored. */
  async finishSignIn(text, { timeout = HTTP_TIMEOUT } = {}) {
    const parsed = parseRedirect(text);
    if (!parsed) {
      throw new IndegoError('sign_in', 'no authorization code in the pasted text');
    }
    if (parsed.error) {
      const detail = String(parsed.errorDescription ?? '')
        .replace(/\s+/g, ' ')
        .slice(0, 120);
      throw new IndegoError(
        'refused',
        `Bosch refused the sign-in (${parsed.error}${detail ? `: ${detail}` : ''})`,
      );
    }
    const verifier = this.takeVerifier(parsed.state);
    if (!verifier) {
      throw new IndegoError(
        'sign_in',
        'this address does not belong to a sign-in started in the last 15 minutes',
      );
    }
    const token = await this.tokenRequest(
      {
        grant_type: 'authorization_code',
        code: parsed.code,
        redirect_uri: OAUTH.REDIRECT_URI,
        code_verifier: verifier,
      },
      timeout,
    );
    await this.accept(token, 'sign_in');
    return token;
  }

  // --- Tokens ---------------------------------------------------------------------------

  async tokenRequest(form, timeout) {
    let response;
    try {
      response = await request(this.tokenUrl, {
        method: 'POST',
        form: true,
        body: { ...form, client_id: OAUTH.CLIENT_ID, scope: OAUTH.SCOPE },
        timeout,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        throw new IndegoError('rate_limited', reasonOf(err), {
          status: 429,
          retryAfter: parseRetryAfter(err.retryAfter, this.now()),
        });
      }
      if (err instanceof HttpError && [400, 401].includes(err.status)) {
        const reason = err.body?.error ?? `HTTP ${err.status}`;
        const detail = String(err.body?.error_description ?? '')
          .split(/\r?\n/)[0]
          .slice(0, 120);
        throw new IndegoError(
          'refused',
          `Bosch refused the sign-in (${reason}${detail ? `: ${detail}` : ''})`,
          { status: err.status },
        );
      }
      throw new IndegoError('unreachable', reasonOf(err), { status: err?.status });
    }
    const token = tokenOf(response.data, this.now());
    if (!token) {
      throw new IndegoError('refused', 'Bosch refused the sign-in (no access token)');
    }
    return token;
  }

  /** Keep a new token and hand it to `onToken` (to store it); `reason`: sign_in | renew. */
  async accept(token, reason) {
    // A refresh answer may come without a new refresh token: keep the old one.
    if (!token.refreshToken && this.token?.refreshToken) {
      token.refreshToken = this.token.refreshToken;
      token.refreshExpiresAt = this.token.refreshExpiresAt;
    }
    this.token = token;
    this.refused = false;
    this.failures = 0;
    this.retryAt = 0;
    this.lastFailure = undefined;
    await this.onToken(token, reason);
  }

  /** Renew the token with the refresh token (one renewal at a time). */
  renew() {
    if (!this.renewing) {
      this.renewing = this.doRenew().finally(() => {
        this.renewing = undefined;
      });
    }
    return this.renewing;
  }

  async doRenew() {
    if (!this.token?.refreshToken) {
      throw new IndegoError('no_token', 'Not signed in to Bosch');
    }
    try {
      const token = await this.tokenRequest(
        { grant_type: 'refresh_token', refresh_token: this.token.refreshToken },
        HTTP_TIMEOUT,
      );
      await this.accept(token, 'renew');
      return token;
    } catch (err) {
      if (err.code === 'refused') {
        // Never tried again by itself: only a new sign-in clears it.
        this.refused = true;
      }
      throw err;
    }
  }

  /** Does the token need renewing (none yet, expired, or within the margin)? */
  get expiring() {
    return (
      Boolean(this.token) &&
      (!this.token.accessToken || this.now() >= this.token.expiresAt - TOKEN_MARGIN)
    );
  }

  /** Is there no usable access token? */
  get expired() {
    return Boolean(this.token) && (!this.token.accessToken || this.now() >= this.token.expiresAt);
  }

  /**
   * Renew the token when it is due and no failed renewal asks to wait: a
   * network failure is tried again after 1, 5, 15 then 60 minutes
   * (TOKEN_RETRY), whatever asks for the token meanwhile. A refusal throws.
   */
  async renewIfDue() {
    if (this.refused) {
      throw new IndegoError('refused', 'The Bosch session expired: sign in again');
    }
    if (!this.expiring || this.now() < this.retryAt) {
      return;
    }
    try {
      await this.renew();
    } catch (err) {
      if (err.code === 'refused' || err.code === 'no_token') {
        throw err;
      }
      const delay = Math.max(
        TOKEN_RETRY[Math.min(this.failures, TOKEN_RETRY.length - 1)],
        err.code === 'rate_limited' ? (err.retryAfter ?? 0) : 0,
      );
      this.failures += 1;
      this.retryAt = this.now() + delay;
      this.lastFailure = err;
    }
  }

  /**
   * A usable access token. `renew: false` (the commands) never renews: a
   * token that expired is an error at once.
   */
  async accessToken({ renew = true } = {}) {
    if (!this.token) {
      throw new IndegoError('no_token', 'Not signed in to Bosch');
    }
    if (this.refused) {
      throw new IndegoError('refused', 'The Bosch session expired: sign in again');
    }
    if (renew) {
      await this.renewIfDue();
    }
    if (this.expired) {
      throw new IndegoError(
        'unreachable',
        `the Bosch session could not be renewed (${reasonOf(this.lastFailure ?? 'not yet')})`,
      );
    }
    return this.token.accessToken;
  }
}
