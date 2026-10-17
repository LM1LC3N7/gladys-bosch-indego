// -----------------------------------------------------------------------------
// The errors of the integration, and a readable reason for any failure
// (never a header, a token, a code or a query string).
// -----------------------------------------------------------------------------

import { HttpError } from '../http.js';

/**
 * What went wrong:
 * - refused: Bosch refused the sign-in or the refresh token (a new sign-in is needed)
 * - no_token: never signed in
 * - unreachable: network, timeout, 5xx, a renewal that failed for one of those
 * - rate_limited: HTTP 429 (`retryAfter` in ms when given)
 * - blocked: HTTP 403 from the Azure gateway (a passing block, not the account)
 * - unauthorized: the API refused a token that was just renewed (401)
 * - api: another 4xx of the API
 * - sign_in: the pasted address is unusable (no code, unknown or expired sign-in)
 * - command: a command refused before it was sent (state unknown, too slow...)
 */
export class IndegoError extends Error {
  /**
   * `detail`: what Bosch said, for the user texts (no prefix of ours);
   * `kind`: a finer cause (sign_in: no_code | truncated | unknown_sign_in;
   * refused: cancelled).
   */
  constructor(code, message, { status, retryAfter, detail, kind } = {}) {
    super(message);
    this.name = 'IndegoError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.detail = detail ?? message;
    this.kind = kind;
  }
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent or unreadable. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    return Number(text) * 1000;
  }
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

/** A readable reason for a failed request. */
export function reasonOf(err) {
  if (err instanceof IndegoError) {
    return err.message;
  }
  if (err instanceof HttpError) {
    const body = err.body;
    let detail = '';
    if (body && typeof body === 'object') {
      detail = body.error_description ?? body.error ?? body.message ?? '';
    } else if (typeof body === 'string') {
      // A gateway answers with an HTML page: its title says it all.
      detail = (/<title>([^<]*)<\/title>/i.exec(body.slice(0, 2000))?.[1] ?? body).trim();
    }
    detail = String(detail).replace(/\s+/g, ' ').slice(0, 120);
    return `${err.message}${detail ? `: ${detail}` : ''}`;
  }
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return 'timeout';
  }
  const cause = err?.cause?.code ?? err?.code;
  return String(cause ?? err?.message ?? err).slice(0, 160);
}
