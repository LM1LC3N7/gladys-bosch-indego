// -----------------------------------------------------------------------------
// The Indego answers -> plain values, and the Gladys states of a mower.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  activityOf,
  alertsOf,
  batteryOf,
  genericOf,
  nextMowOf,
  safeId,
  stateOf,
} from '../src/indego/model.js';
import {
  buildMowerDevice,
  dockStateOf,
  lastAlertText,
  mowerStates,
  parseExternalId,
} from '../src/devices.js';
import { DOCK_STATE, RUN_MODE } from '../src/constants.js';
import { T } from '../src/i18n.js';
import { fixture } from './helpers/fakeIndego.js';

test('state codes -> activities, with the blocks of pyIndego for unknown codes', () => {
  const cases = {
    513: 'mowing',
    266: 'mowing',
    518: 'mowing',
    517: 'paused',
    520: 'paused',
    519: 'idle',
    771: 'returning',
    800: 'returning',
    257: 'charging',
    260: 'charging',
    258: 'docked',
    64513: 'docked',
    300: 'docked',
    259: 'updating',
    1281: 'updating',
    101: 'error',
    1537: 'error',
    1038: 'error',
    1005: 'error',
    99999: 'offline',
    0: 'unknown',
    4242: 'unknown',
  };
  for (const [code, activity] of Object.entries(cases)) {
    assert.equal(activityOf(Number(code)), activity, code);
  }
  assert.equal(activityOf(null), 'unknown');
  assert.equal(activityOf('513'), 'unknown');
});

test('activities -> the Gladys vacuum-cleaner state', () => {
  assert.equal(dockStateOf('mowing'), DOCK_STATE.RUNNING);
  assert.equal(dockStateOf('paused'), DOCK_STATE.PAUSED);
  assert.equal(dockStateOf('returning'), DOCK_STATE.RETURNING);
  assert.equal(dockStateOf('charging'), DOCK_STATE.CHARGING);
  assert.equal(dockStateOf('docked'), DOCK_STATE.DOCKED);
  assert.equal(dockStateOf('updating'), DOCK_STATE.DOCKED);
  assert.equal(dockStateOf('error'), DOCK_STATE.ERROR);
  assert.equal(dockStateOf('idle'), DOCK_STATE.STOPPED);
  assert.equal(dockStateOf('offline'), DOCK_STATE.STOPPED);
});

test('the state answer: code, progress, error', () => {
  assert.deepEqual(stateOf(fixture('state-docked.json')), { code: 64513, mowed: 97, error: 0 });
  assert.deepEqual(stateOf({ state: 513 }), { code: 513, mowed: undefined, error: undefined });
  assert.deepEqual(stateOf({ state: 513, mowed: 140 }).mowed, 100);
  for (const junk of [null, [], {}, { state: 'x' }, 'text']) {
    assert.equal(stateOf(junk), null);
  }
});

test('battery: a percentage, the raw scale of the first models', () => {
  assert.equal(batteryOf(fixture('operating.json'), '3600HB0102'), 86);
  assert.equal(batteryOf({ battery: { percent: 340 } }, '3600HA2300'), 65);
  assert.equal(batteryOf({ battery: { percent: 400 } }, '3600HA2301'), 100);
  assert.equal(batteryOf({ battery: { percent: 250 } }, '3600HA2301'), 0);
  assert.equal(batteryOf({ battery: { percent: 120 } }, null), 100);
  assert.equal(batteryOf({}, null), null);
  assert.equal(batteryOf({ battery: { percent: null } }, null), null);
  assert.equal(batteryOf(null, null), null);
});

test('next mowing: in the time of the garden', () => {
  assert.equal(nextMowOf(fixture('nextcutting.json')), '2026-10-18 10:00');
  assert.equal(nextMowOf({ mow_next: '2026-10-18T08:00:00.000Z' }), '2026-10-18 08:00 UTC');
  assert.equal(nextMowOf({ mow_next: 'tomorrow' }), null);
  assert.equal(nextMowOf(null), null);
});

test('generic data: name, model, firmware', () => {
  assert.deepEqual(genericOf(fixture('generic.json')), {
    name: 'Pelouse',
    tool: '3600HB0102',
    model: 'Indego S+ 350 1gen',
    firmware: '17329.01211',
  });
  assert.equal(genericOf({ bareToolnumber: '3600XX' }).model, '3600XX');
  assert.equal(genericOf(null).name, null);
});

test('alerts: newest first, read flag, junk dropped', () => {
  const alerts = alertsOf([...fixture('alerts.json'), { foo: 1 }, null]);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].id, '5efda84ffbf591182723be89');
  assert.equal(alerts[0].read, false);
  assert.equal(alerts[0].code, '104');
  assert.equal(alerts[1].read, true);
  assert.equal(alertsOf('nope').length, 0);
  assert.equal(lastAlertText(alerts[0], 'en').startsWith('Mower requires attention.: Stop'), true);
  assert.equal(lastAlertText(null, 'fr'), 'Aucune');
});

test('external ids: the serial, made safe, and back', () => {
  const gladys = createFakeGladys({ selector: 'bosch-indego' });
  const device = buildMowerDevice(gladys, { serial: '603100001', name: 'Pelouse' }, 'fr');
  assert.equal(device.external_id, 'ext:bosch-indego:mower:603100001');
  assert.equal(parseExternalId(device.external_id), '603100001');
  assert.equal(safeId('60 31/00'), '60_31_00');
  assert.equal(parseExternalId('ext:other:thing'), undefined);
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').at(-1)),
    [
      'state',
      'run_mode',
      'dock',
      'battery',
      'activity',
      'state_code',
      'progress',
      'next_mow',
      'alerts',
      'last_alert',
      'connected',
    ],
  );
  const runMode = device.features.find((f) => f.external_id.endsWith(':run_mode'));
  assert.deepEqual(
    runMode.supported_options.map((o) => o.value),
    [RUN_MODE.IDLE, RUN_MODE.CLEANING],
  );
  // Units: only the battery (a percent, the one unit of its category).
  assert.deepEqual(
    device.features.filter((f) => f.unit).map((f) => [f.category, f.unit]),
    [['battery', 'percent']],
  );
});

test('states: unknown values left out, texts in the chosen language', () => {
  const base = {
    code: null,
    activity: 'unknown',
    stateText: T.stateText(null, 'unknown'),
    mowed: null,
    battery: null,
    nextMow: null,
    nextMowRead: false,
    alertsRead: false,
    alertsUnread: 0,
    lastAlert: null,
  };
  assert.deepEqual(mowerStates('d', base, 'fr'), []);
  const states = mowerStates(
    'd',
    {
      ...base,
      code: 513,
      activity: 'mowing',
      stateText: T.stateText(513, 'mowing'),
      mowed: 42,
      battery: 80,
      nextMowRead: true,
      alertsRead: true,
    },
    'fr',
  );
  const value = (key) => states.find((s) => s.device_feature_external_id === `d:${key}`);
  assert.equal(value('state').state, DOCK_STATE.RUNNING);
  assert.equal(value('run_mode').state, RUN_MODE.CLEANING);
  assert.equal(value('activity').text, 'Tonte');
  assert.equal(value('state_code').state, 513);
  assert.equal(value('progress').state, 42);
  assert.equal(value('next_mow').text, 'Aucune prévue');
  assert.equal(value('alerts').state, 0);
  assert.equal(value('last_alert').text, 'Aucune');
  assert.equal(value('connected').state, 1);
  assert.equal(T.stateText(4242, 'unknown').en, 'Unknown (code 4242)');
});
