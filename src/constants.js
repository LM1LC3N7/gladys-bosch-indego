// -----------------------------------------------------------------------------
// Constants of the Bosch Indego integration.
//
// The Bosch names (URLs, paths, the OAuth2 client, the state codes, the
// commands) come from sander1988/pyIndego 3.x (MIT) and sander1988/Indego
// (Apache-2.0), the Home Assistant integration built on it; see
// THIRD_PARTY_NOTICES.md. Nothing here was checked against a real account.
// -----------------------------------------------------------------------------

/** The Indego cloud API (pyIndego DEFAULT_URL). */
export const API_URL = 'https://api.indego-cloud.iot.bosch-si.com/api/v1/';

/**
 * Bosch SingleKey ID: an Azure AD B2C tenant (sander1988/Indego const.py and
 * api.py). The client is the one of the Bosch Indego app, public (no secret);
 * its only redirect is the app's own scheme, which no browser can open: the
 * sign-in ends on a failed redirect whose address carries the code, and the
 * user pastes that address back (src/indego/auth.js).
 */
export const OAUTH = {
  AUTHORIZE_URL:
    'https://prodindego.b2clogin.com/prodindego.onmicrosoft.com/b2c_1a_signup_signin/oauth2/v2.0/authorize',
  TOKEN_URL:
    'https://prodindego.b2clogin.com/prodindego.onmicrosoft.com/b2c_1a_signup_signin/oauth2/v2.0/token',
  CLIENT_ID: '65bb8c9d-1070-4fb4-aa95-853618acc876',
  REDIRECT_URI: 'com.bosch.indegoconnect://login',
  SCOPE:
    'openid profile email offline_access https://prodindego.onmicrosoft.com/indego-mobile-api/Indego.Mower.User',
};

export const PATHS = {
  MOWERS: 'alms',
  mower: (serial) => `alms/${encodeURIComponent(serial)}`,
  state: (serial) => `alms/${encodeURIComponent(serial)}/state`,
  operating: (serial) => `alms/${encodeURIComponent(serial)}/operatingData`,
  nextMow: (serial) => `alms/${encodeURIComponent(serial)}/predictive/nextcutting`,
  ALERTS: 'alerts',
};

/** The commands of PUT alms/<serial>/state (pyIndego COMMANDS). */
export const COMMANDS = { MOW: 'mow', PAUSE: 'pause', DOCK: 'returnToDock' };

/**
 * An identifiable User-Agent: the Azure gateway in front of the API answers
 * 403 to some default ones (pyIndego issue #119, Indego issue #204).
 */
export const USER_AGENT =
  'gladys-bosch-indego/0.1 (+https://github.com/LM1LC3N7/gladys-bosch-indego)';

// --- Pacing ------------------------------------------------------------------------

export const HTTP_TIMEOUT = 20_000;
/**
 * The long poll of the state: the cloud holds the request until the state
 * code changes or `timeout` seconds pass (pyIndego caps it at 230: the Azure
 * load balancer resets an idle connection at 240 s).
 */
export const LONGPOLL_SECONDS = 230;
/** A long poll that came back sooner than this waits the rest before the next one. */
export const LONGPOLL_MIN_GAP = 30_000;
/** The loop wakes up this often; most ticks make no call. */
export const TICK_INTERVAL = 30_000;
/** Battery (operating data) while the mower works or charges, and otherwise. */
export const OPERATING_ACTIVE = 10 * 60_000;
export const OPERATING_IDLE = 6 * 60 * 60_000;
/** Alerts and next mowing (the 10-minute refresh of the Home Assistant integration). */
export const SLOW_INTERVAL = 10 * 60_000;
/** The mower list and their names, models and firmware. */
export const LIST_INTERVAL = 12 * 60 * 60_000;
/** Failed reads are tried again after these delays (then the last one). */
export const BACKOFF = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000];
/** A 429 pauses every call for Retry-After, bounded to this range (5 min without one). */
export const RATE_LIMIT_MIN = 60_000;
export const RATE_LIMIT_MAX = 6 * 60 * 60_000;
export const RATE_LIMIT_DEFAULT = 5 * 60_000;
/** An API 401 renews the token at most this often (never in a loop). */
export const UNAUTHORIZED_RENEW_GAP = 10 * 60_000;

/** Renew the access token that long before it expires. */
export const TOKEN_MARGIN = 5 * 60_000;
/** A failed renewal (network, gateway) is tried again after these delays. */
export const TOKEN_RETRY = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
/** A started sign-in (its PKCE verifier) is kept that long, five at most. */
export const SIGN_IN_TTL = 15 * 60_000;
export const SIGN_IN_MAX = 5;

/**
 * Gladys gives up on a set_value after 5 s: a command must be sent within
 * this budget from its arrival, or refused before anything is sent.
 */
export const ACK_BUDGET = 3_500;
/** Time kept for the command request itself: below it, nothing is sent. */
export const SEND_RESERVE = 1_200;
/** The state is read back that long after a command. */
export const READ_BACK = [10_000, 45_000];

// --- Gladys ------------------------------------------------------------------------

/** VACUUM_CLEANER_STATE of Gladys (server/utils/constants.js). */
export const DOCK_STATE = {
  STOPPED: 0,
  RUNNING: 1,
  PAUSED: 2,
  ERROR: 3,
  RETURNING: 4,
  CHARGING: 5,
  DOCKED: 6,
};
/** VACUUM_CLEANER_MODE of Gladys: the run mode select (IDLE pauses, CLEANING mows). */
export const RUN_MODE = { IDLE: 0, CLEANING: 1 };

export const LANGUAGES = ['fr', 'en'];

// --- Manifest keys (forever: stored in user scenes and configurations) -------------

/** The account_link field of the config_schema (the Connect button). */
export const ACCOUNT_KEY = 'account';
/** Where the tokens are kept (a config key outside the config_schema). */
export const TOKEN_KEY = 'indego_token';

export const ACTIONS = {
  START: 'start_sign_in',
  FINISH: 'finish_sign_in',
  TEST: 'test_connection',
};
export const SCENE_TRIGGERS = { ALERT: 'mower_alert' };
