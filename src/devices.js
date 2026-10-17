// -----------------------------------------------------------------------------
// The Gladys devices and their states. Pure.
//
// External id (forever):  mower:<serial>   one Indego mower (its serial number)
//
// Like LM1LC3N7/gladys-automower and gladys-navimow, the operational state
// and the two commands use Gladys' `vacuum-cleaner` category, the only one
// describing a robot that runs, docks and charges: its device card labels
// the state Stopped / Running / Paused / Error / Returning to dock /
// Charging / Docked, offers a run mode select (Idle: pause, Clean: mow) and
// a "Return to dock" button.
//
// Units: only the ones the core lists for the category
// (DEVICE_FEATURE_UNITS_BY_CATEGORY): the battery is a percent; the mowing
// progress (category `unknown`) carries none, its name says "%".
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DOCK_STATE, RUN_MODE } from './constants.js';
import { T as TEXT, pick } from './i18n.js';
import { safeId } from './indego/model.js';

/** The feature keys (the last segment of the feature external ids). Forever. */
export const FEATURE = {
  STATE: 'state',
  RUN_MODE: 'run_mode',
  DOCK: 'dock',
  BATTERY: 'battery',
  ACTIVITY: 'activity',
  STATE_CODE: 'state_code',
  PROGRESS: 'progress',
  NEXT_MOW: 'next_mow',
  ALERTS: 'alerts',
  LAST_ALERT: 'last_alert',
  CONNECTED: 'connected',
};

export const ids = {
  mower: (gladys, serial) => gladys.externalId(`mower:${safeId(serial)}`),
  feature: (deviceId, key) => `${deviceId}:${key}`,
};

/** The serial part of a device external id ("ext:x:mower:<serial>" -> "<serial>"), or undefined. */
export function parseExternalId(externalId) {
  const match = /:mower:([A-Za-z0-9_.-]+)$/.exec(String(externalId ?? ''));
  return match ? match[1] : undefined;
}

/** The key of a feature external id ("ext:x:mower:<serial>:dock" -> "dock"). */
export const featureKeyOf = (externalId) =>
  String(externalId ?? '')
    .split(':')
    .at(-1);

/** The Gladys vacuum-cleaner state of an activity. */
export function dockStateOf(activity) {
  switch (activity) {
    case 'error':
      return DOCK_STATE.ERROR;
    case 'paused':
      return DOCK_STATE.PAUSED;
    case 'mowing':
      return DOCK_STATE.RUNNING;
    case 'returning':
      return DOCK_STATE.RETURNING;
    case 'charging':
      return DOCK_STATE.CHARGING;
    case 'docked':
    case 'updating':
      return DOCK_STATE.DOCKED;
    default:
      return DOCK_STATE.STOPPED;
  }
}

/** The run mode select: CLEANING while the mower mows, IDLE otherwise. */
export const runModeOf = (activity) => (activity === 'mowing' ? RUN_MODE.CLEANING : RUN_MODE.IDLE);

const feature = (deviceId, key, name, category, type, extra = {}) => ({
  name,
  external_id: ids.feature(deviceId, key),
  category,
  type,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

export function buildMowerDevice(gladys, mower, language = 'fr') {
  const id = ids.mower(gladys, mower.serial);
  const name = (key) => pick(TEXT.features[key], language);
  const text = (key) =>
    feature(id, key, name(key), C.TEXT, T.TEXT.TEXT, { min: 0, max: 0, keep_history: false });
  return {
    name: mower.name,
    external_id: id,
    features: [
      feature(id, FEATURE.STATE, name('state'), C.VACUUM_CLEANER, T.VACUUM_CLEANER.STATE, {
        max: 6,
      }),
      feature(id, FEATURE.RUN_MODE, name('run_mode'), C.VACUUM_CLEANER, T.VACUUM_CLEANER.RUN_MODE, {
        read_only: false,
        has_feedback: true,
        keep_history: false,
        // A mower has no mapping pass to offer: only Idle and Clean.
        supported_options: [
          { value: RUN_MODE.IDLE, label: TEXT.runOptions.pause, sort_order: 1 },
          { value: RUN_MODE.CLEANING, label: TEXT.runOptions.mow, sort_order: 2 },
        ],
      }),
      feature(id, FEATURE.DOCK, name('dock'), C.VACUUM_CLEANER, T.VACUUM_CLEANER.DOCK, {
        read_only: false,
        keep_history: false,
      }),
      feature(id, FEATURE.BATTERY, name('battery'), C.BATTERY, T.BATTERY.INTEGER, {
        unit: U.PERCENT,
        max: 100,
      }),
      text(FEATURE.ACTIVITY),
      feature(id, FEATURE.STATE_CODE, name('state_code'), C.UNKNOWN, T.SENSOR.INTEGER, {
        max: 100_000,
      }),
      feature(id, FEATURE.PROGRESS, name('progress'), C.UNKNOWN, T.SENSOR.INTEGER, { max: 100 }),
      text(FEATURE.NEXT_MOW),
      feature(id, FEATURE.ALERTS, name('alerts'), C.UNKNOWN, T.SENSOR.INTEGER, { max: 1000 }),
      text(FEATURE.LAST_ALERT),
      feature(id, FEATURE.CONNECTED, name('connected'), C.UNKNOWN, T.SENSOR.BINARY),
    ],
    params: [
      { name: 'serial_number', value: mower.serial },
      { name: 'model', value: mower.model ?? '' },
      { name: 'firmware', value: mower.firmware ?? '' },
    ],
  };
}

const entry = (deviceId, key, value) =>
  value === null || value === undefined
    ? []
    : [
        typeof value === 'string'
          ? { device_feature_external_id: ids.feature(deviceId, key), text: value }
          : { device_feature_external_id: ids.feature(deviceId, key), state: value },
      ];

/** The text of the last alert: "headline: message", or "None". */
export function lastAlertText(alert, language) {
  if (!alert) {
    return pick(TEXT.none, language);
  }
  const parts = [alert.headline, alert.message].filter(Boolean);
  return (parts.length > 0 ? parts.join(': ') : alert.code || '?').slice(0, 250);
}

/** The states of a mower device; texts in `language`. Unknown values are left out. */
export function mowerStates(deviceId, mower, language = 'fr') {
  const known = mower.code !== null && mower.code !== undefined;
  return [
    ...entry(deviceId, FEATURE.STATE, known ? dockStateOf(mower.activity) : null),
    ...entry(deviceId, FEATURE.RUN_MODE, known ? runModeOf(mower.activity) : null),
    ...entry(deviceId, FEATURE.BATTERY, mower.battery),
    ...entry(deviceId, FEATURE.ACTIVITY, known ? pick(mower.stateText, language) : null),
    ...entry(deviceId, FEATURE.STATE_CODE, known ? mower.code : null),
    ...entry(deviceId, FEATURE.PROGRESS, mower.mowed),
    ...entry(
      deviceId,
      FEATURE.NEXT_MOW,
      mower.nextMowRead ? (mower.nextMow ?? pick(TEXT.noNextMow, language)) : null,
    ),
    ...entry(deviceId, FEATURE.ALERTS, mower.alertsRead ? mower.alertsUnread : null),
    ...entry(
      deviceId,
      FEATURE.LAST_ALERT,
      mower.alertsRead ? lastAlertText(mower.lastAlert, language) : null,
    ),
    ...entry(deviceId, FEATURE.CONNECTED, known ? (mower.activity === 'offline' ? 0 : 1) : null),
  ];
}
