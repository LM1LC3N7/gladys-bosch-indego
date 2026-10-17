// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// The tokens live in a key of their own outside the schema (TOKEN_KEY).
// -----------------------------------------------------------------------------

import { LANGUAGES, TOKEN_KEY } from './constants.js';
import { tokenFromStore } from './indego/auth.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  poll_minutes: 5,
  longpoll: true,
  language: 'fr',
};

/** Bounds of the number fields (also the manifest's `min` / `max`). */
export const BOUNDS = {
  poll_minutes: [2, 60],
};

const number = (value, key) => {
  const [min, max] = BOUNDS[key];
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value !== null && value !== undefined
    ? Math.min(max, Math.max(min, Math.round(n)))
    : DEFAULTS[key];
};

export function normalizeConfig(raw = {}) {
  const language = String(raw.language ?? DEFAULTS.language).toLowerCase();
  return {
    pollMinutes: number(raw.poll_minutes, 'poll_minutes'),
    longpoll: typeof raw.longpoll === 'boolean' ? raw.longpoll : DEFAULTS.longpoll,
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
    token: tokenFromStore(raw[TOKEN_KEY]),
  };
}
