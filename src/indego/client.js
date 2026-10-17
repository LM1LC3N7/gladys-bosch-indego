// -----------------------------------------------------------------------------
// The Indego cloud API (the paths of sander1988/pyIndego): the mowers of the
// account, their state (with the long poll), operating data (battery), next
// mowing, the alerts, and the three commands. Every answer is classified
// into an IndegoError (src/indego/errors.js) so the app can pace itself.
// -----------------------------------------------------------------------------

import {
  API_URL,
  HTTP_TIMEOUT,
  LONGPOLL_SECONDS,
  PATHS,
  UNAUTHORIZED_RENEW_GAP,
} from '../constants.js';
import { HttpError, request } from '../http.js';
import { IndegoError, parseRetryAfter, reasonOf } from './errors.js';

export class IndegoClient {
  constructor({ auth, apiUrl = API_URL, now = Date.now }) {
    this.auth = auth;
    this.apiUrl = apiUrl;
    this.now = now;
    this.lastUnauthorizedRenew = -Infinity;
  }

  /** One API call: the data, or null for "no content" (204, a long poll without change). */
  async call(
    path,
    { method = 'GET', body, timeout = HTTP_TIMEOUT, longpoll = false, renew = true } = {},
  ) {
    const send = async () => {
      const token = await this.auth.accessToken({ renew });
      const answer = await request(`${this.apiUrl}${path}`, {
        method,
        body,
        timeout,
        headers: { Authorization: `Bearer ${token}` },
      });
      return answer.status === 204 || answer.data === undefined ? null : answer.data;
    };
    try {
      try {
        return await send();
      } catch (err) {
        // A refused token is renewed once, then the call is tried again
        // once; never more than once every 10 minutes.
        if (
          err instanceof HttpError &&
          err.status === 401 &&
          renew &&
          this.now() - this.lastUnauthorizedRenew >= UNAUTHORIZED_RENEW_GAP
        ) {
          this.lastUnauthorizedRenew = this.now();
          await this.auth.renew();
          return await send();
        }
        throw err;
      }
    } catch (err) {
      if (err instanceof IndegoError) {
        throw err;
      }
      if (err instanceof HttpError) {
        if (err.status === 504 && longpoll) {
          return null;
        }
        throw this.classify(err);
      }
      throw new IndegoError('unreachable', reasonOf(err));
    }
  }

  classify(err) {
    const { status } = err;
    const options = { status };
    if (status === 401) {
      return new IndegoError(
        'unauthorized',
        `the Indego cloud refused the session (${reasonOf(err)})`,
        options,
      );
    }
    if (status === 403) {
      return new IndegoError(
        'blocked',
        `the Indego cloud gateway blocked the call (${reasonOf(err)})`,
        options,
      );
    }
    if (status === 429) {
      return new IndegoError('rate_limited', reasonOf(err), {
        ...options,
        retryAfter: parseRetryAfter(err.retryAfter, this.now()),
      });
    }
    if (status >= 500 || status === 408) {
      return new IndegoError('unreachable', reasonOf(err), options);
    }
    return new IndegoError('api', reasonOf(err), options);
  }

  /** The mowers of the account: [{ serial }]. */
  async mowers() {
    const data = await this.call(PATHS.MOWERS);
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((entry) => ({ serial: typeof entry?.alm_sn === 'string' ? entry.alm_sn.trim() : '' }))
      .filter((entry) => entry.serial);
  }

  /** Name, model, firmware, mowing mode of a mower (alms/<serial>). */
  generic(serial) {
    return this.call(PATHS.mower(serial));
  }

  /**
   * The state. `longpoll`: held by the cloud until the state code differs
   * from `last` (null: no change within LONGPOLL_SECONDS).
   */
  state(serial, { longpoll = false, last = 0, timeout = HTTP_TIMEOUT, renew = true } = {}) {
    if (!longpoll) {
      return this.call(PATHS.state(serial), { timeout, renew });
    }
    const query = `?longpoll=true&timeout=${LONGPOLL_SECONDS}&last=${Number(last) || 0}`;
    return this.call(`${PATHS.state(serial)}${query}`, {
      longpoll: true,
      timeout: (LONGPOLL_SECONDS + 20) * 1000,
    });
  }

  /** Battery, garden, runtime (alms/<serial>/operatingData). */
  operating(serial) {
    return this.call(PATHS.operating(serial));
  }

  /** The next mowing of the SmartMowing schedule, or null when there is none. */
  async nextMow(serial) {
    try {
      return await this.call(PATHS.nextMow(serial));
    } catch (err) {
      // No SmartMowing (calendar or manual mode): no next mowing to read.
      if (err.code === 'api' && [400, 404].includes(err.status)) {
        return null;
      }
      throw err;
    }
  }

  /** The alerts of the account (every mower). */
  async alerts() {
    const data = await this.call(PATHS.ALERTS);
    return Array.isArray(data) ? data : [];
  }

  /** A command (mow | pause | returnToDock), with the current token only. */
  command(serial, command, { timeout }) {
    return this.call(PATHS.state(serial), {
      method: 'PUT',
      body: { state: command },
      timeout,
      renew: false,
    });
  }
}
