// -----------------------------------------------------------------------------
// The only place that talks HTTP: `fetch` with a timeout, an identifiable
// User-Agent and a bounded read. The tests replace it with `setFetch()`.
//
// An error never carries a header (the token travels in them) nor a query
// string: the path and the status only.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

/** The most read from one answer: the Bosch answers are a few kilobytes of JSON. */
export const MAX_BODY = 512 * 1024;

export class HttpError extends Error {
  constructor(status, url, body, headers) {
    super(`HTTP ${status} on ${new URL(url).pathname}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.retryAfter = headers?.get?.('retry-after') ?? undefined;
  }
}

const parse = (text) => {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** The body as text, at most `max` bytes (the rest is dropped, the stream cancelled). */
async function readBounded(response, max) {
  if (!response.body?.getReader) {
    return (await response.text()).slice(0, max);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    if (size >= max) {
      // Not awaited: a tee'd body only settles its cancel once both branches do.
      reader.cancel().catch(() => {});
    }
  }
  return Buffer.concat(chunks).subarray(0, max).toString('utf8');
}

/**
 * One request. `body` is form-encoded with `form: true`, else JSON-encoded.
 * Resolves { status, data }; throws an HttpError on a non-2xx status (with
 * the parsed body), and the fetch error (timeout, DNS...) as it is.
 */
export async function request(
  url,
  { method = 'GET', headers = {}, body, form = false, timeout = HTTP_TIMEOUT, signal } = {},
) {
  const deadline = AbortSignal.timeout(Math.max(1, Math.round(timeout)));
  const init = {
    method,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
    redirect: 'error',
    // `signal`: the caller can cancel too (a long poll when the app stops).
    signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
    init.body = form ? new URLSearchParams(body).toString() : JSON.stringify(body);
  }
  const response = await fetchImpl(url, init);
  const text = await readBounded(response, MAX_BODY);
  if (!response.ok) {
    throw new HttpError(response.status, url, parse(text.slice(0, 2000)), response.headers);
  }
  return { status: response.status, data: parse(text) };
}
