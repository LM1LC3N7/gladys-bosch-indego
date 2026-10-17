// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys (every handler of
// src/handlers.js) and a fake Bosch cloud.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { IndegoApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import {
  ACK_BUDGET,
  ACTIONS,
  BACKOFF,
  DOCK_STATE,
  LONGPOLL_MIN_GAP,
  READ_BACK,
  RUN_MODE,
  SCENE_TRIGGERS,
  TOKEN_KEY,
} from '../src/constants.js';
import { tokenOf, tokenToStore } from '../src/indego/auth.js';
import {
  FIXTURE_NOW,
  PELOUSE,
  RENEWED,
  TOKEN,
  VERGER,
  fixture,
  installIndego,
  json,
} from './helpers/fakeIndego.js';
import { createFakeTimers, settle } from './helpers/fakeTimers.js';

let fake;
afterEach(() => fake?.restore());

const MINUTE = 60_000;
const STORED = tokenToStore(tokenOf(TOKEN, FIXTURE_NOW));
const SIGNED_IN = { [TOKEN_KEY]: STORED, poll_minutes: 5, longpoll: true, language: 'en' };
const DEVICE = `ext:bosch-indego:mower:${PELOUSE}`;
const DEVICE2 = `ext:bosch-indego:mower:${VERGER}`;

async function setup({ config = SIGNED_IN, create = true, overrides } = {}) {
  const clock = { now: FIXTURE_NOW };
  fake = installIndego({ clock, ...overrides });
  const gladys = createFakeGladys({ selector: 'bosch-indego', config });
  const timers = createFakeTimers();
  const logs = [];
  const log = (...args) => logs.push(args.map(String).join(' '));
  const logger = { info: log, warn: log, error: log, debug: log };
  const app = new IndegoApp({ gladys, logger, now: () => clock.now, timers });
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  await settle();
  if (create) {
    for (const device of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(device);
    }
  }
  await settle();
  return { app, gladys, timers, clock, logs };
}

const state = (gladys, device, key) => gladys.fake.lastState(`${device}:${key}`);
const feature = (device, key) => ({ external_id: `${device}:${key}` });
const mow = (ctx) =>
  ctx.gladys.fake.setValue({ external_id: DEVICE }, feature(DEVICE, 'run_mode'), RUN_MODE.CLEANING);
const pause = (ctx) =>
  ctx.gladys.fake.setValue({ external_id: DEVICE }, feature(DEVICE, 'run_mode'), RUN_MODE.IDLE);
const dock = (ctx) => ctx.gladys.fake.setValue({ external_id: DEVICE }, feature(DEVICE, 'dock'), 1);
const readBacks = (ctx) => ctx.timers.timeouts().filter((t) => READ_BACK.includes(t.ms));
const tick = async (ctx, ms = 30_000) => {
  ctx.clock.now += ms;
  await ctx.timers.runIntervals();
  await settle();
};
const longpolls = (ctx) => ctx.timers.timeouts().filter((t) => !READ_BACK.includes(t.ms));
const runLongpolls = async (ctx) => {
  await ctx.timers.runTimeouts((t) => !READ_BACK.includes(t.ms));
  await settle();
};
const message = (ack) => ack.data?.message ?? ack.data;
const consoleLine = (state, code) =>
  `Failed to launch 'com.bosch.indegoconnect://login?state=${state}&code=${code}' because the scheme does not have a registered handler.`;

// --- Sign-in ---------------------------------------------------------------------------

test('not signed in: a status that says what to do, and no call to Bosch', async () => {
  const { gladys } = await setup({ config: {} });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /^Not connected: click "Connect"/);
  assert.match(gladys.fake.connectionStatus.message.fr, /^Non connecté/);
  assert.equal(fake.calls.length, 0);
  assert.match(message(await gladys.fake.action(ACTIONS.TEST, {})).en, /^Not connected/);
  const ack = await gladys.fake.setValue({ external_id: DEVICE }, feature(DEVICE, 'dock'), 1);
  assert.equal(ack.success, false);
});

test('the start action, then the pasted console line: signed in, token kept, mowers found', async () => {
  const { gladys, logs, app } = await setup({ config: {}, create: false });
  const started = message(await gladys.fake.action(ACTIONS.START, {}));
  assert.match(started.en, /F12, or Cmd\+Option\+I on a Mac/);
  assert.match(started.en, /Preserve log/);
  assert.match(started.fr, /Conserver le journal/);
  assert.match(started.fr, /outils de développement/);
  const url = /https:\/\/prodindego\.b2clogin\.com\/\S+/.exec(started.en)[0];
  assert.equal(/https:\/\/\S+/.exec(started.fr)[0], url, 'the same address in both languages');
  const stateParam = new URL(url).searchParams.get('state');
  const code = fake.issueCode(url);

  const ack = await gladys.fake.action(ACTIONS.FINISH, { url: consoleLine(stateParam, code) });
  assert.equal(ack.success, true);
  // The action answers at once; the mowers are read in the background.
  assert.match(message(ack).en, /^Signed in\. The mowers are being read/);
  await app.starting;
  await settle();
  const stored = gladys.fake.config[TOKEN_KEY];
  assert.equal(stored.refresh_token, TOKEN.refresh_token);
  assert.equal(stored.access_token, TOKEN.access_token);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]),
    [
      [DEVICE, 'Pelouse'],
      [DEVICE2, 'Verger'],
    ],
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const all = logs.join('\n');
  for (const secret of [TOKEN.access_token, TOKEN.refresh_token, code, stateParam]) {
    assert.ok(!all.includes(secret), 'no token, code or state in the logs');
  }
});

test('the Connect button gives the same kind of address; bad pastes are explained', async () => {
  const { gladys } = await setup({ config: {}, create: false });
  const ack = await gladys.fake.oauthAuthorizeUrl('account', undefined);
  assert.equal(ack.success, true);
  const url = ack.data.authorize_url ?? ack.data;
  assert.equal(new URL(url).searchParams.get('redirect_uri'), 'com.bosch.indegoconnect://login');
  const stateParam = new URL(url).searchParams.get('state');

  assert.match(
    message(await gladys.fake.action(ACTIONS.FINISH, { url: 'hello' })).en,
    /^No sign-in code/,
  );
  assert.match(
    message(await gladys.fake.action(ACTIONS.FINISH, { url: consoleLine('other', 'c') })).en,
    /does not belong to a sign-in/,
  );
  const refused = message(
    await gladys.fake.action(ACTIONS.FINISH, { url: consoleLine(stateParam, 'bad') }),
  );
  assert.match(
    refused.en,
    /^Bosch refused the sign-in \(invalid_grant: AADB2C90080[^)]*\): the code serves once.*start again at step 1\.$/,
  );
  assert.match(refused.fr, /^Bosch a refusé la connexion \(invalid_grant: AADB2C90080/);
  assert.doesNotMatch(refused.fr, /refused the sign-in/, 'no English prefix in French');
  assert.match(refused.fr, /recommencez à l'étape 1\.$/);
  const cut = message(
    await gladys.fake.action(ACTIONS.FINISH, {
      url: 'com.bosch.indegoconnect://login?state=abc&code=eyJraWQiOiJjcGlt…',
    }),
  );
  assert.match(cut.en, /cut short by the console/);
  assert.match(cut.fr, /Copier l'adresse du lien/);
  const cancelled = message(
    await gladys.fake.action(ACTIONS.FINISH, {
      url: 'com.bosch.indegoconnect://login?error=access_denied&error_description=AADB2C90091%3a+The+user+has+cancelled+entering+self-asserted+information.&state=x',
    }),
  );
  assert.equal(cancelled.en, 'The sign-in was cancelled on the Bosch page: start again at step 1.');
  assert.match(cancelled.fr, /^La connexion a été annulée/);
  assert.equal(gladys.fake.config[TOKEN_KEY], undefined);
  assert.equal(fake.api().length, 0);
});

test('Bosch unreachable while finishing: an honest message, and the same paste works again', async () => {
  const { gladys, app } = await setup({ config: {}, create: false });
  const started = message(await gladys.fake.action(ACTIONS.START, {}));
  const url = /https:\/\/\S+/.exec(started.en)[0];
  const paste = consoleLine(new URL(url).searchParams.get('state'), fake.issueCode(url));
  fake.state.fail.set('/oauth2/v2.0/token', new TypeError('fetch failed'));
  const failed = message(await gladys.fake.action(ACTIONS.FINISH, { url: paste }));
  assert.match(failed.fr, /^Bosch est injoignable \(fetch failed\) : recollez la même adresse/);
  assert.doesNotMatch(failed.fr, /nouvel essai prévu/);
  fake.state.fail.clear();
  const again = message(await gladys.fake.action(ACTIONS.FINISH, { url: paste }));
  assert.match(again.en, /^Signed in\./);
  await app.starting;
  await settle();
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

// --- Reading -------------------------------------------------------------------------

test('signed in: every value of both mowers is published', async () => {
  const { gladys } = await setup();
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Connected: 2 mowers, live state (long poll).',
      fr: 'Connecté : 2 tondeuses, état en direct (longue interrogation).',
    },
  });
  const [pelouse] = gladys.fake.discoveredDevices;
  assert.deepEqual(pelouse.params, [
    { name: 'serial_number', value: PELOUSE },
    { name: 'model', value: 'Indego S+ 350 1gen' },
    { name: 'firmware', value: '17329.01211' },
  ]);
  assert.equal(state(gladys, DEVICE, 'state'), DOCK_STATE.DOCKED);
  assert.equal(state(gladys, DEVICE, 'run_mode'), RUN_MODE.IDLE);
  assert.equal(state(gladys, DEVICE, 'activity'), 'Sleeping');
  assert.equal(state(gladys, DEVICE, 'state_code'), 64513);
  assert.equal(state(gladys, DEVICE, 'battery'), 86);
  assert.equal(state(gladys, DEVICE, 'progress'), 97);
  assert.equal(state(gladys, DEVICE, 'next_mow'), '2026-10-18 10:00');
  assert.equal(state(gladys, DEVICE, 'alerts'), 1);
  assert.match(state(gladys, DEVICE, 'last_alert'), /^Mower requires attention\.: Stop button/);
  assert.equal(state(gladys, DEVICE, 'connected'), 1);
  assert.equal(state(gladys, DEVICE2, 'battery'), 65, 'the raw scale of the first models');
  assert.equal(state(gladys, DEVICE2, 'next_mow'), 'None planned');
  assert.equal(state(gladys, DEVICE2, 'alerts'), 0);
  assert.equal(state(gladys, DEVICE2, 'last_alert'), 'None');
  // Nothing fired for the alerts already there.
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('the long poll: one per mower, a change published, never two within 30 s', async () => {
  const ctx = await setup();
  const { gladys } = ctx;
  assert.equal(longpolls(ctx).length, 2);
  fake.state.longpoll.set(PELOUSE, fixture('state-mowing.json'));
  await runLongpolls(ctx);
  const polls = fake.to('longpoll=true');
  assert.equal(polls.length, 2);
  assert.deepEqual(polls[0].query, { longpoll: 'true', timeout: '230', last: '64513' });
  assert.equal(state(gladys, DEVICE, 'state'), DOCK_STATE.RUNNING);
  assert.equal(state(gladys, DEVICE, 'run_mode'), RUN_MODE.CLEANING);
  assert.equal(state(gladys, DEVICE, 'progress'), 42);
  assert.deepEqual(
    longpolls(ctx).map((t) => t.ms),
    [LONGPOLL_MIN_GAP, LONGPOLL_MIN_GAP],
  );
  await runLongpolls(ctx);
  assert.equal(fake.to('longpoll=true').at(-2).query.last, '513');
});

test('pace: nothing while docked, the state every 5 min while mowing, the rest every 10 min', async () => {
  const ctx = await setup();
  const before = fake.api().length;
  for (let i = 0; i < 9; i += 1) {
    await tick(ctx);
  }
  assert.equal(fake.api().length, before, 'docked, long poll on: no call in 4.5 min');
  fake.state.longpoll.set(PELOUSE, fixture('state-mowing.json'));
  fake.state.states.set(PELOUSE, fixture('state-mowing.json'));
  await runLongpolls(ctx);
  const since = (mark) =>
    fake
      .api()
      .slice(mark)
      .map((c) => c.path.replace(/^\/api\/v1\//, ''));
  // 4.5 min: the long poll brought "mowing". 5 min later, the mowing one is
  // read again (its progress); battery (10 min while out), alerts and next
  // mowing are not due yet.
  const mark = fake.api().length;
  await tick(ctx, 5 * MINUTE);
  assert.deepEqual(since(mark), [`alms/${PELOUSE}/state`]);
  // 10.5 min since the start: battery of the mowing one, alerts, next mowing.
  const mark2 = fake.api().length;
  await tick(ctx, MINUTE);
  assert.deepEqual(
    since(mark2).sort(),
    [
      `alms/${PELOUSE}/operatingData`,
      `alms/${PELOUSE}/predictive/nextcutting`,
      `alms/${VERGER}/predictive/nextcutting`,
      'alerts',
    ].sort(),
  );
});

test('long poll off: a plain read of every mower every 5 minutes', async () => {
  const ctx = await setup({ config: { ...SIGNED_IN, longpoll: false } });
  assert.equal(longpolls(ctx).length, 0);
  const mark = fake.api().length;
  await tick(ctx, 5 * MINUTE);
  assert.deepEqual(
    fake
      .api()
      .slice(mark)
      .map((c) => c.path.replace(/^\/api\/v1\//, '')),
    [`alms/${PELOUSE}/state`, `alms/${VERGER}/state`],
  );
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /^Connected: 2 mowers\.$/);
});

// --- Commands --------------------------------------------------------------------------

test('mow: the state is read first, then the command, then read back', async () => {
  const ctx = await setup();
  const mark = fake.api().length;
  const ack = await ctx.gladys.fake.setValue(
    { external_id: DEVICE },
    feature(DEVICE, 'run_mode'),
    RUN_MODE.CLEANING,
  );
  assert.equal(ack.success, true);
  const calls = fake.api().slice(mark);
  assert.deepEqual(
    calls.map((c) => [c.method, c.path.replace(/^\/api\/v1\//, ''), c.query.longpoll]),
    [
      ['GET', `alms/${PELOUSE}/state`, undefined],
      ['PUT', `alms/${PELOUSE}/state`, undefined],
    ],
  );
  assert.deepEqual(fake.state.commands, [{ serial: PELOUSE, command: 'mow' }]);
  assert.deepEqual(
    ctx.timers
      .timeouts()
      .filter((t) => READ_BACK.includes(t.ms))
      .map((t) => t.ms),
    READ_BACK,
  );
  fake.state.states.set(PELOUSE, fixture('state-mowing.json'));
  await ctx.timers.runTimeouts((t) => READ_BACK.includes(t.ms));
  await settle();
  assert.equal(state(ctx.gladys, DEVICE, 'state'), DOCK_STATE.RUNNING);
});

test('a stop is always sent; only a start while mowing is skipped', async () => {
  const ctx = await setup();
  // Docked: dock and pause are sent all the same (the cloud state can lag).
  await dock(ctx);
  await pause(ctx);
  assert.deepEqual(
    fake.state.commands.map((c) => c.command),
    ['returnToDock', 'pause'],
  );
  // Mowing, once the guard of the last command is over: a start changes nothing.
  ctx.clock.now += 91_000;
  fake.state.states.set(PELOUSE, fixture('state-mowing.json'));
  const ack = await mow(ctx);
  assert.equal(ack.success, true);
  assert.deepEqual(
    fake.state.commands.map((c) => c.command),
    ['returnToDock', 'pause'],
    'already mowing: not sent',
  );
  await pause(ctx);
  await dock(ctx);
  assert.deepEqual(
    fake.state.commands.map((c) => c.command),
    ['returnToDock', 'pause', 'pause', 'returnToDock'],
  );
  const bad = await ctx.gladys.fake.setValue(
    { external_id: DEVICE },
    feature(DEVICE, 'battery'),
    1,
  );
  assert.equal(bad.success, false);
});

test('a state that cannot be read, or an offline mower: nothing is sent', async () => {
  const ctx = await setup();
  fake.state.fail.set(`alms/${PELOUSE}/state`, json({ message: 'down' }, 503));
  const ack = await ctx.gladys.fake.setValue(
    { external_id: DEVICE },
    feature(DEVICE, 'run_mode'),
    RUN_MODE.CLEANING,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /NOT sent/);
  fake.state.fail.clear();
  fake.state.states.set(PELOUSE, { state: 99999 });
  const offline = await ctx.gladys.fake.setValue(
    { external_id: DEVICE },
    feature(DEVICE, 'run_mode'),
    RUN_MODE.CLEANING,
  );
  assert.equal(offline.success, false);
  assert.match(offline.error, /offline/);
  assert.equal(fake.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('a slow cloud: the command is refused before it is sent, within 3.5 s', async () => {
  const ctx = await setup();
  fake.state.slow.set(`alms/${PELOUSE}/state`, 2_500);
  const start = ctx.clock.now;
  const ack = await ctx.gladys.fake.setValue(
    { external_id: DEVICE },
    feature(DEVICE, 'run_mode'),
    RUN_MODE.CLEANING,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /too slowly, the command was NOT sent/);
  assert.deepEqual(fake.state.commands, []);
  assert.ok(ctx.clock.now - start <= ACK_BUDGET);
});

test('commands to one mower run one after the other', async () => {
  const ctx = await setup();
  fake.state.states.set(PELOUSE, fixture('state-mowing.json'));
  const mark = fake.api().length;
  const [a, b] = await Promise.all([
    ctx.gladys.fake.setValue({ external_id: DEVICE }, feature(DEVICE, 'run_mode'), RUN_MODE.IDLE),
    ctx.gladys.fake.setValue({ external_id: DEVICE }, feature(DEVICE, 'dock'), 1),
  ]);
  assert.equal(a.success && b.success, true);
  assert.deepEqual(
    fake
      .api()
      .slice(mark)
      .map((c) => c.method),
    ['GET', 'PUT', 'GET', 'PUT'],
  );
});

test('mow and dock at once on a docked mower whose state lags: both are sent', async () => {
  const ctx = await setup();
  const [a, b] = await Promise.all([mow(ctx), dock(ctx)]);
  assert.equal(a.success && b.success, true);
  assert.deepEqual(
    fake.state.commands.map((c) => c.command),
    ['mow', 'returnToDock'],
  );
});

test('mow, then pause 3 s later while the cloud still says docked: the pause is sent', async () => {
  const ctx = await setup();
  await mow(ctx);
  ctx.clock.now += 3_000;
  const p = await pause(ctx);
  assert.equal(p.success, true);
  assert.deepEqual(
    fake.state.commands.map((c) => c.command),
    ['mow', 'pause'],
  );
});

test('the guard: a start is not skipped right after a stop, until the stop shows', async () => {
  const ctx = await setup();
  fake.state.states.set(PELOUSE, fixture('state-mowing.json'));
  await pause(ctx);
  // The cloud still says mowing: the guard of the pause stands, the start is sent.
  await mow(ctx);
  assert.deepEqual(
    fake.state.commands.map((c) => c.command),
    ['pause', 'mow'],
  );
  // The mower was seen paused, then mowing: the guard of the start is lifted.
  fake.state.states.set(PELOUSE, { state: 517 });
  await ctx.timers.runTimeouts((t) => t.ms === READ_BACK[0]);
  fake.state.states.set(PELOUSE, fixture('state-mowing.json'));
  await ctx.timers.runTimeouts((t) => t.ms === READ_BACK[1]);
  await settle();
  assert.equal(ctx.app.guards.has(PELOUSE), false);
  await mow(ctx);
  assert.equal(fake.state.commands.length, 2, 'already mowing, no guard: skipped');
});

test('a slow cloud and two commands at once: the second is refused, never sent late', async () => {
  const ctx = await setup();
  fake.state.slow.set(`alms/${PELOUSE}/state`, 2_000);
  const [a, b] = await Promise.all([mow(ctx), pause(ctx)]);
  assert.equal(a.success, true);
  assert.equal(b.success, false);
  assert.match(b.error, /NOT sent/);
  assert.deepEqual(
    fake.state.commands.map((c) => c.command),
    ['mow'],
  );
});

test('a command whose answer does not come in time: said sent, read back kept', async () => {
  const ctx = await setup();
  let answer;
  fake.state.fail.set(`alms/${PELOUSE}/state`, (call) => {
    if (call.method === 'PUT') {
      fake.state.commands.push({ serial: PELOUSE, command: call.body.state });
      return new Promise((resolve) => {
        answer = resolve;
      });
    }
    return json(fake.state.states.get(PELOUSE));
  });
  const pending = mow(ctx);
  await settle();
  // The deadline of the ack (3.5 s from the command) passes.
  await ctx.timers.runTimeouts((t) => t.ms > 0 && t.ms <= ACK_BUDGET);
  const ack = await pending;
  assert.equal(ack.success, false);
  assert.equal(
    ack.error,
    'Indego: command sent, but not confirmed in time; the state will be read again in 10 s.',
  );
  assert.equal(fake.state.commands.length, 1, 'the request was never cut');
  assert.equal(readBacks(ctx).length, 2);
  answer(new Response(null, { status: 200 }));
  await settle();
  assert.ok(ctx.logs.some((l) => /confirmed late/.test(l)));
});

test('a command that failed on the way (timeout, network): said maybe sent, read back', async () => {
  const ctx = await setup();
  fake.state.fail.set(`alms/${PELOUSE}/state`, (call) => {
    if (call.method === 'PUT') {
      fake.state.commands.push({ serial: PELOUSE, command: call.body.state });
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    return json(fake.state.states.get(PELOUSE));
  });
  const ack = await mow(ctx);
  assert.equal(ack.success, false);
  assert.match(ack.error, /command sent, but not confirmed in time/);
  assert.equal(readBacks(ctx).length, 2);
});

test('command errors follow the configured language', async () => {
  const ctx = await setup({ config: { ...SIGNED_IN, language: 'fr' } });
  fake.state.states.set(PELOUSE, { state: 99999 });
  const ack = await dock(ctx);
  assert.equal(ack.error, "Indego : la tondeuse est hors ligne, la commande n'a PAS été envoyée.");
});

test('read backs that fail: logged, a 429 pauses, a refused session stops', async () => {
  const ctx = await setup();
  await mow(ctx);
  fake.state.fail.set(`alms/${PELOUSE}/state`, json({ message: 'down' }, 503));
  await ctx.timers.runTimeouts((t) => READ_BACK.includes(t.ms));
  await settle();
  assert.ok(ctx.logs.some((l) => /Read back of 603100001 failed: HTTP 503/.test(l)));
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);

  fake.state.fail.clear();
  ctx.clock.now += 60_000;
  await mow(ctx);
  fake.state.fail.set(
    `alms/${PELOUSE}/state`,
    json({ message: 'slow' }, 429, { 'retry-after': '120' }),
  );
  await ctx.timers.runTimeouts((t) => READ_BACK.includes(t.ms));
  await settle();
  assert.equal(ctx.app.pausedUntil - ctx.clock.now, 120_000);

  ctx.clock.now += 11 * MINUTE;
  fake.state.fail.clear();
  assert.equal((await mow(ctx)).success, true);
  fake.state.valid.clear();
  fake.state.refreshTokens.clear();
  await ctx.timers.runTimeouts((t) => READ_BACK.includes(t.ms));
  await settle();
  assert.equal(ctx.app.fatal?.code, 'refused');
  assert.equal(ctx.timers.pending.size, 0);
  assert.equal(fake.to('/token').length, 1, 'one renewal, refused, never again');
});

test('a secondary read that fails never blocks the state', async () => {
  const ctx = await setup();
  fake.state.fail.set('nextcutting', json({ message: 'down' }, 503));
  fake.state.fail.set('operatingData', new TypeError('fetch failed'));
  fake.state.longpoll.set(PELOUSE, fixture('state-mowing.json'));
  fake.state.states.set(PELOUSE, fixture('state-mowing.json'));
  await runLongpolls(ctx);
  await tick(ctx, 10 * MINUTE);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  assert.equal(state(ctx.gladys, DEVICE, 'state'), DOCK_STATE.RUNNING);
  assert.ok(ctx.logs.some((l) => /^Next mowing of 603100001: HTTP 503/.test(l)));
  assert.ok(ctx.logs.some((l) => /^Battery of 603100001: fetch failed/.test(l)));
  // Each one waits its own back-off.
  const before = fake.to('nextcutting').length;
  await tick(ctx, 10_000);
  assert.equal(fake.to('nextcutting').length, before, 'not before its own retry time');
  fake.state.fail.clear();
  await tick(ctx, 25_000);
  assert.equal(state(ctx.gladys, DEVICE, 'next_mow'), '2026-10-18 10:00');
});

test('stopping cancels the pending long polls', async () => {
  const ctx = await setup();
  const signals = [];
  fake.state.fail.set('longpoll=true', (call) => {
    signals.push(call.signal);
    return new Promise((_, reject) =>
      call.signal.addEventListener('abort', () => reject(call.signal.reason)),
    );
  });
  const runs = longpolls(ctx).map((t) => {
    ctx.timers.pending.delete(t.id);
    return t.fn();
  });
  await settle();
  assert.equal(signals.length, 2);
  ctx.app.stop();
  await Promise.all(runs);
  assert.ok(signals.every((s) => s.aborted));
  assert.equal(longpolls(ctx).length, 0, 'no new long poll after a stop');
});

// --- Failures --------------------------------------------------------------------------

test('a 429 pauses every call (reads, long poll, commands) for its Retry-After', async () => {
  const ctx = await setup();
  fake.state.fail.set('/alerts', json({ message: 'slow down' }, 429, { 'retry-after': '600' }));
  await tick(ctx, 10 * MINUTE);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /Next call in 10 min/);
  fake.state.fail.clear();
  const mark = fake.calls.length;
  await tick(ctx, 2 * MINUTE);
  await runLongpolls(ctx);
  const ack = await ctx.gladys.fake.setValue({ external_id: DEVICE }, feature(DEVICE, 'dock'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /too many requests/);
  assert.equal(fake.calls.length, mark, 'no call during the pause');
  await tick(ctx, 9 * MINUTE);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
});

test('a 429 without Retry-After pauses 5 minutes, at least 1 minute with a short one', async () => {
  const ctx = await setup();
  fake.state.fail.set('/alerts', json({ message: 'slow down' }, 429, { 'retry-after': '2' }));
  await tick(ctx, 10 * MINUTE);
  assert.equal(ctx.app.pausedUntil - ctx.clock.now, MINUTE);
  fake.state.fail.set('/alerts', json({ message: 'slow down' }, 429));
  await tick(ctx, 10 * MINUTE);
  assert.equal(ctx.app.pausedUntil - ctx.clock.now, 5 * MINUTE);
});

test('transient failures back off: 30 s, 1 min, 2 min...', async () => {
  const ctx = await setup({ config: { ...SIGNED_IN, longpoll: false } });
  fake.state.fail.set('/state', new TypeError('fetch failed'));
  await tick(ctx, 5 * MINUTE);
  assert.equal(ctx.app.nextTryAt - ctx.clock.now, BACKOFF[0]);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /cannot be reached \(fetch failed\)/);
  await tick(ctx, BACKOFF[0]);
  assert.equal(ctx.app.nextTryAt - ctx.clock.now, BACKOFF[1]);
  fake.state.fail.set('/state', new Response('<title>Forbidden</title>', { status: 403 }));
  await tick(ctx, BACKOFF[1]);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /gateway refuses/);
  fake.state.fail.clear();
  await tick(ctx, BACKOFF[2]);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  assert.ok(ctx.timers.intervals().length === 1, 'never dead: the loop is still there');
});

test('a refused refresh token: everything stops until a new sign-in', async () => {
  const ctx = await setup();
  fake.state.refreshTokens.clear();
  await tick(ctx, 60 * MINUTE);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /expired or was refused/);
  assert.equal(ctx.timers.pending.size, 0, 'no loop, no long poll');
  const mark = fake.calls.length;
  const ack = await ctx.gladys.fake.setValue({ external_id: DEVICE }, feature(DEVICE, 'dock'), 1);
  assert.equal(ack.success, false);
  assert.equal(fake.calls.length, mark);
  // A new sign-in starts again.
  const started = message(await ctx.gladys.fake.action(ACTIONS.START, {}));
  const url = /https:\/\/\S+/.exec(started.en)[0];
  fake.state.refreshTokens.set(RENEWED.refresh_token, RENEWED);
  fake.state.token = RENEWED;
  const done = await ctx.gladys.fake.action(ACTIONS.FINISH, {
    url: `com.bosch.indegoconnect://login?state=${new URL(url).searchParams.get('state')}&code=${fake.issueCode(url)}`,
  });
  assert.match(message(done).en, /^Signed in/);
  await ctx.app.starting;
  await settle();
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  assert.equal(ctx.gladys.fake.config[TOKEN_KEY].refresh_token, RENEWED.refresh_token);
});

test('the token is renewed ahead and stored', async () => {
  const ctx = await setup();
  await tick(ctx, 56 * MINUTE);
  assert.equal(fake.to('/token').length, 1);
  assert.equal(ctx.gladys.fake.config[TOKEN_KEY].access_token, RENEWED.access_token);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
});

// --- Alerts, test, scan ------------------------------------------------------------------

test('a new unread alert fires the trigger once, with the mower', async () => {
  const ctx = await setup();
  fake.state.alerts = [
    {
      alm_sn: PELOUSE,
      alert_id: 'new-alert-1',
      error_code: '115',
      headline: 'Mower is stuck.',
      date: '2026-10-17T10:05:00.000Z',
      message: 'Please free the mower.',
      read_status: 'unread',
      flag: 'error',
    },
    ...fixture('alerts.json'),
  ];
  await tick(ctx, 10 * MINUTE);
  await tick(ctx, 10 * MINUTE);
  const events = ctx.gladys.fake.sceneEvents.filter((e) => e.key === SCENE_TRIGGERS.ALERT);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, {
    mower: DEVICE,
    mower_name: 'Pelouse',
    code: '115',
    headline: 'Mower is stuck.',
    message: 'Please free the mower.',
    flag: 'error',
  });
  assert.equal(state(ctx.gladys, DEVICE, 'alerts'), 2);
  assert.equal(state(ctx.gladys, DEVICE, 'last_alert'), 'Mower is stuck.: Please free the mower.');
});

test('the test action: state and battery of each mower', async () => {
  const { gladys } = await setup();
  const text = message(await gladys.fake.action(ACTIONS.TEST, {}));
  assert.equal(
    text.en,
    'Connected. Pelouse: Sleeping, battery 86 %; Verger: Sleeping, battery 65 %.',
  );
  assert.equal(
    text.fr,
    'Connecté. Pelouse : En veille, batterie 86 % ; Verger : En veille, batterie 65 %.',
  );
});

test('a scan reads the list again: a removed mower disappears', async () => {
  const ctx = await setup();
  fake.state.mowers = [{ alm_sn: PELOUSE }];
  await ctx.gladys.fake.scanRequest();
  assert.deepEqual(
    ctx.gladys.fake.discoveredDevices.map((d) => d.external_id),
    [DEVICE],
  );
  assert.equal(longpolls(ctx).length, 1);
});
