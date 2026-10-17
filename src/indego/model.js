// -----------------------------------------------------------------------------
// The Indego answers -> plain values. Pure.
//
// The state codes, their grouping, the model table and the battery scale of
// the first models are adapted from sander1988/pyIndego (const.py,
// states.py: MIT, see THIRD_PARTY_NOTICES.md).
// -----------------------------------------------------------------------------

/** Mower state code -> activity (pyIndego MOWER_STATE_DESCRIPTION_DETAIL, grouped). */
const ACTIVITY_BY_CODE = new Map([
  [0, 'unknown'], // reading status
  [101, 'error'], // lifted
  [257, 'charging'],
  [258, 'docked'],
  [259, 'updating'],
  [260, 'charging'],
  [261, 'docked'],
  [262, 'docked'], // loading map
  [263, 'docked'], // saving map
  [266, 'mowing'], // leaving the dock
  [517, 'paused'],
  [519, 'idle'], // idle in the lawn
  [520, 'paused'], // learning the lawn, paused
  [525, 'idle'], // random mowing complete
  [1005, 'error'], // could not enter the charging station
  [1025, 'idle'], // diagnostic mode
  [1026, 'error'], // end of life
  [1027, 'idle'], // service requesting status
  [1038, 'error'], // immobilized
  [1281, 'updating'],
  [1537, 'error'], // stuck on the lawn
  [64513, 'docked'], // sleeping
  [99999, 'offline'],
]);

/** The activities, in the order of the docs. */
export const ACTIVITIES = [
  'mowing',
  'paused',
  'returning',
  'docked',
  'charging',
  'idle',
  'error',
  'updating',
  'offline',
  'unknown',
];

/** The state code -> one of ACTIVITIES. */
export function activityOf(code) {
  if (typeof code !== 'number' || !Number.isInteger(code)) {
    return 'unknown';
  }
  if (ACTIVITY_BY_CODE.has(code)) {
    return ACTIVITY_BY_CODE.get(code);
  }
  // The blocks of pyIndego's table: 2xx-3xx at the station, 5xx mowing, 7xx-9xx returning.
  if (code >= 256 && code < 512) {
    return 'docked';
  }
  if (code >= 512 && code < 768) {
    return 'mowing';
  }
  if (code >= 768 && code < 1024) {
    return 'returning';
  }
  return 'unknown';
}

/** The activities during which the mower is out of its station. */
export const ACTIVE = new Set(['mowing', 'returning', 'paused']);

/** pyIndego MOWER_MODEL_DESCRIPTION (bareToolnumber -> model). */
const MODELS = {
  '3600HA2300': 'Indego 1000',
  '3600HA2301': 'Indego 1200',
  '3600HA2302': 'Indego 1100',
  '3600HA2303': 'Indego 13C',
  '3600HA2304': 'Indego 10C',
  '3600HB0100': 'Indego 350',
  '3600HB0101': 'Indego 400',
  '3600HB0102': 'Indego S+ 350 1gen',
  '3600HB0103': 'Indego S+ 400 1gen',
  '3600HB0105': 'Indego S+ 350 2gen',
  '3600HB0106': 'Indego S+ 400 2gen',
  '3600HB0302': 'Indego S+ 500',
  '3600HB0301': 'Indego M+ 700 1gen',
  '3600HB0303': 'Indego M+ 700 2gen',
};

const text = (value, max = 80) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** alms/<serial> -> { name, model, firmware }. */
export function genericOf(data) {
  const tool = text(data?.bareToolnumber, 40);
  return {
    name: text(data?.alm_name),
    tool,
    model: tool ? (MODELS[tool] ?? tool) : null,
    firmware: text(data?.alm_firmware_version, 40),
  };
}

const integer = (value) => {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n)
    ? Math.round(n)
    : null;
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** alms/<serial>/state -> { code, mowed, error }; only the fields the answer carries. */
export function stateOf(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const code = integer(data.state);
  if (code === null) {
    return null;
  }
  const mowed = integer(data.mowed);
  const error = integer(data.error);
  return {
    code,
    mowed: mowed === null ? undefined : clamp(mowed, 0, 100),
    error: error === null ? undefined : error,
  };
}

/**
 * The battery level in % from operatingData. The first models (3600HA23xx)
 * report a raw value between 285 and 369 (pyIndego MOWER_MODEL_VOLTAGE),
 * the others a percentage.
 */
export function batteryOf(data, tool) {
  const raw = Number(data?.battery?.percent);
  if (
    data?.battery?.percent === null ||
    data?.battery?.percent === undefined ||
    !Number.isFinite(raw)
  ) {
    return null;
  }
  if (String(tool ?? '').startsWith('3600HA23')) {
    return clamp(Math.round((raw - 285) / ((369 - 285) / 100)), 0, 100);
  }
  return clamp(Math.round(raw), 0, 100);
}

/**
 * The next mowing as text, in the time of the mower's garden: the answer
 * carries its offset ("2026-10-18T10:00:00+02:00" -> "2026-10-18 10:00"),
 * a UTC instant says so ("... UTC"). Null without a date.
 */
export function nextMowOf(data) {
  const value = typeof data?.mow_next === 'string' ? data.mow_next.trim() : '';
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  return `${match[1]} ${match[2]}${match[3] === 'Z' ? ' UTC' : ''}`;
}

/** The alerts answer -> [{ id, serial, code, headline, message, flag, read, at }], newest first. */
export function alertsOf(list) {
  return (Array.isArray(list) ? list : [])
    .filter((a) => a && typeof a === 'object' && text(a.alert_id, 100))
    .map((a) => ({
      id: text(a.alert_id, 100),
      serial: text(a.alm_sn, 100),
      code:
        a.error_code === null || a.error_code === undefined
          ? ''
          : String(a.error_code).slice(0, 60),
      headline: text(a.headline, 200) ?? '',
      message: text(a.message, 1000) ?? '',
      flag: text(a.flag, 40) ?? '',
      read: a.read_status === 'read',
      at: Number.isFinite(Date.parse(a.date)) ? Date.parse(a.date) : 0,
    }))
    .sort((a, b) => b.at - a.at);
}

/** A serial as it goes in an external id. */
export const safeId = (serial) => String(serial).replace(/[^A-Za-z0-9_.-]/g, '_');
