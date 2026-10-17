// -----------------------------------------------------------------------------
// The integration itself: the Bosch SingleKey ID sign-in (address pasted
// back), discovery, the reading loop, the long poll of the state, the
// commands, the alert trigger and the test button. index.js only wires the
// SDK handlers to it (src/handlers.js).
//
// Pace (the Bosch cloud documents no limit; this follows the Home Assistant
// integration, a bit slower):
// - at start: the mower list, then per mower its name/model, state,
//   battery and next mowing, and the alerts of the account;
// - the state: a long poll per mower (the cloud answers when the state code
//   changes, or after 230 s), never two within 30 s; plus a plain read every
//   `poll_minutes` (5) while the mower is out, for the mowing progress (the
//   long poll only wakes up on a state change). Without the long poll, a
//   plain read every `poll_minutes` whatever the state;
// - battery every 10 min while the mower is out or charging, every 6 h
//   otherwise; alerts and next mowing every 10 min (alerts at once when the
//   state reports a new error); the mower list every 12 h;
// - failures: 30 s, 1, 2, 5, 10 then 15 min; a 429 pauses EVERY call
//   (reads, long poll, commands) for its Retry-After, 1 min to 6 h (5 min
//   without one); a refused refresh token stops everything until a new
//   sign-in (never retried by itself).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  ACCOUNT_KEY,
  ACK_BUDGET,
  BACKOFF,
  COMMANDS,
  GUARD_TTL,
  LIST_INTERVAL,
  LONGPOLL_MIN_GAP,
  OPERATING_ACTIVE,
  OPERATING_IDLE,
  RATE_LIMIT_DEFAULT,
  RATE_LIMIT_MAX,
  RATE_LIMIT_MIN,
  READ_BACK,
  RUN_MODE,
  SCENE_TRIGGERS,
  SEND_RESERVE,
  SLOW_INTERVAL,
  TICK_INTERVAL,
  TOKEN_KEY,
} from './constants.js';
import {
  FEATURE,
  buildMowerDevice,
  featureKeyOf,
  ids,
  mowerStates,
  parseExternalId,
} from './devices.js';
import { T, pick } from './i18n.js';
import { IndegoAuth, tokenToStore } from './indego/auth.js';
import { IndegoClient } from './indego/client.js';
import { IndegoError, reasonOf } from './indego/errors.js';
import {
  ACTIVE,
  activityOf,
  alertsOf,
  batteryOf,
  genericOf,
  nextMowOf,
  safeId,
  stateOf,
} from './indego/model.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

/** A sign-in problem nothing but a new sign-in can fix. */
const isFinal = (err) => ['refused', 'no_token'].includes(err?.code);

/**
 * The only command ever skipped: a start while the mower already mows. A stop
 * (pause, back to the station) is always sent: the cloud state can lag, and a
 * lost stop order is worse than a useless one.
 */
const SKIPPABLE = { [COMMANDS.MOW]: new Set(['mowing']) };

/** The activities that show a command took effect (they lift its guard). */
const EXPECTED = {
  [COMMANDS.MOW]: new Set(['mowing']),
  [COMMANDS.PAUSE]: new Set(['paused', 'idle', 'docked', 'charging']),
  [COMMANDS.DOCK]: new Set(['returning', 'docked', 'charging']),
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export class IndegoApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'bosch-indego' }),
    now = Date.now,
    timers = defaultTimers,
    apiUrl,
    tokenUrl,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.config = normalizeConfig();
    this.auth = new IndegoAuth({
      ...(tokenUrl ? { tokenUrl } : {}),
      now,
      onToken: (token) => this.tokenChanged(token),
    });
    this.client = new IndegoClient({ auth: this.auth, now, ...(apiUrl ? { apiUrl } : {}) });
    this.generation = 0;
    this.tickTimer = undefined;
    this.ticking = undefined;
    this.lastStatus = undefined;
    /** serial -> the tail of its command queue */
    this.queues = new Map();
    /** serial -> timer of its next long poll */
    this.longpollTimers = new Map();
    /** serial -> timers of its read back after a command */
    this.readBackTimers = new Map();
    /** serial -> AbortController of its pending long poll */
    this.longpollAborts = new Map();
    /**
     * serial -> { command, at, startCode, moved }: the last command sent, until
     * its expected state is seen after a move, or GUARD_TTL. While it stands,
     * a different command is never skipped.
     */
    this.guards = new Map();
    this.records = new Map();
    /** A 429 pauses every call until then; a restart keeps it. */
    this.pausedUntil = 0;
    this.reset();
  }

  reset() {
    this.lastListAt = -Infinity;
    this.alertsAt = -Infinity;
    /** A state reported a new error: read the alerts at the next tick. */
    this.alertsWanted = false;
    /** The alert ids seen (null until the first read: those never fire). */
    this.alertsSeen = null;
    this.failures = 0;
    this.nextTryAt = 0;
    this.longpollFailures = new Map();
    /** secondary read -> { failures, at }: its own back-off */
    this.secondaryRetry = new Map();
    this.healthy = false;
    this.fatal = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------------

  /** (Re)start with a configuration (Gladys connected, the user saved it, a sign-in). */
  async start(raw = {}) {
    this.stop();
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.auth.load(this.config.token);
    // A restart keeps the mowers it knew (commandable meanwhile).
    this.reset();
    if (!this.auth.signedIn) {
      await this.setStatus(false, T.notSignedIn);
      return;
    }
    if (this.auth.refused) {
      this.fatal = new IndegoError('refused', 'sign in again');
      await this.setStatus(false, T.refused);
      return;
    }
    if (this.now() < this.pausedUntil) {
      // A 429 is still running: the tick reads once it is over.
      await this.setStatus(false, T.rateLimited(this.pausedUntil - this.now()));
    } else {
      try {
        await this.auth.renewIfDue();
        await this.refresh({ full: true });
      } catch (err) {
        await this.failed(err);
      }
    }
    if (generation !== this.generation || this.fatal) {
      return;
    }
    this.tickTimer = this.timers.setInterval(
      () => this.tick().catch((err) => this.logger.warn(`Tick failed: ${err.message}`)),
      TICK_INTERVAL,
    );
    if (this.config.longpoll) {
      for (const serial of this.records.keys()) {
        this.scheduleLongpoll(serial, 0);
      }
    }
    if (this.healthy) {
      await this.reportOk();
    }
  }

  stop() {
    this.generation += 1;
    this.timers.clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    for (const timer of this.longpollTimers.values()) {
      this.timers.clearTimeout(timer);
    }
    this.longpollTimers.clear();
    for (const controller of this.longpollAborts.values()) {
      controller.abort();
    }
    this.longpollAborts.clear();
    for (const list of this.readBackTimers.values()) {
      list.forEach((timer) => this.timers.clearTimeout(timer));
    }
    this.readBackTimers.clear();
  }

  shutdown() {
    this.stop();
  }

  /** Only a new sign-in can help: nothing more until then. */
  halt(err) {
    this.fatal = err;
    // stop() moves the generation on: the long polls and read backs end.
    this.stop();
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async reportOk() {
    if (this.records.size === 0) {
      await this.setStatus(true, T.noMower);
      return;
    }
    await this.setStatus(true, T.ok({ mowers: this.records.size, longpoll: this.config.longpoll }));
  }

  /**
   * A failed call: a refusal stops everything (status says to sign in
   * again), a 429 pauses every call, anything else is tried again later.
   */
  async failed(err) {
    this.healthy = false;
    const now = this.now();
    this.logger.warn(`Indego: ${reasonOf(err)}`);
    if (err?.code === 'no_token') {
      this.halt(err);
      await this.setStatus(false, T.notSignedIn);
    } else if (isFinal(err)) {
      this.halt(err);
      await this.setStatus(false, T.refused);
    } else if (err?.code === 'rate_limited') {
      const wait = clamp(err.retryAfter ?? RATE_LIMIT_DEFAULT, RATE_LIMIT_MIN, RATE_LIMIT_MAX);
      this.pausedUntil = Math.max(this.pausedUntil, now + wait);
      await this.setStatus(false, T.rateLimited(this.pausedUntil - now));
    } else {
      this.failures += 1;
      this.nextTryAt = now + BACKOFF[Math.min(this.failures - 1, BACKOFF.length - 1)];
      await this.setStatus(
        false,
        err?.code === 'blocked' ? T.blocked(reasonOf(err)) : T.unreachable(reasonOf(err)),
      );
    }
  }

  // --- Tokens ----------------------------------------------------------------------------

  /** A new token: store it in Gladys (in clear in its database, like any config value). */
  async tokenChanged(token) {
    try {
      await this.gladys.setConfig({ [TOKEN_KEY]: tokenToStore(token) });
    } catch (err) {
      this.logger.warn(`Could not store the Bosch token: ${err.message}`);
    }
  }

  // --- Reading -----------------------------------------------------------------------

  emptyRecord(serial) {
    return {
      serial,
      name: null,
      tool: null,
      model: null,
      firmware: null,
      code: null,
      mowed: null,
      error: undefined,
      stateAt: -Infinity,
      battery: null,
      operatingAt: -Infinity,
      nextMow: null,
      nextMowRead: false,
      nextMowAt: -Infinity,
      alertsRead: false,
      alertsUnread: 0,
      lastAlert: null,
    };
  }

  /** The mower list, with name, model and firmware of each. */
  async readList() {
    const mowers = await this.client.mowers();
    this.lastListAt = this.now();
    const seen = new Set();
    for (const { serial } of mowers) {
      seen.add(serial);
      const record = this.records.get(serial) ?? this.emptyRecord(serial);
      this.records.set(serial, record);
      try {
        Object.assign(record, genericOf(await this.client.generic(serial)));
      } catch (err) {
        if (err.code === 'rate_limited' || isFinal(err)) {
          throw err;
        }
        // The details are secondary: the mower stays listed, read again next time.
        this.logger.warn(`Details of ${safeId(serial)}: ${reasonOf(err)}`);
      }
    }
    for (const serial of [...this.records.keys()]) {
      if (!seen.has(serial)) {
        this.records.delete(serial);
        this.timers.clearTimeout(this.longpollTimers.get(serial));
        this.longpollTimers.delete(serial);
      }
    }
    await this.publishDevices();
    if (this.config.longpoll && this.tickTimer) {
      for (const serial of seen) {
        if (!this.longpollTimers.has(serial)) {
          this.scheduleLongpoll(serial, 0);
        }
      }
    }
  }

  /** Merge a state answer; false when it carries no state. */
  applyState(serial, data) {
    const record = this.records.get(serial);
    const state = stateOf(data);
    if (!record || !state) {
      return false;
    }
    record.code = state.code;
    const guard = this.guards.get(serial);
    if (guard) {
      // Lifted by the expected state, but not by the starting one until the
      // mower was seen moving (the cloud can lag behind the command).
      if (state.code !== guard.startCode) {
        guard.moved = true;
      }
      if (guard.moved && EXPECTED[guard.command].has(activityOf(state.code))) {
        this.guards.delete(serial);
      }
    }
    if (state.mowed !== undefined) {
      record.mowed = state.mowed;
    }
    if (state.error !== undefined) {
      // A new error code: the alerts have news (the Home Assistant integration does the same).
      if (record.error !== undefined && state.error !== record.error) {
        this.alertsWanted = true;
      }
      record.error = state.error;
    }
    record.stateAt = this.now();
    return true;
  }

  async readState(serial, options) {
    this.applyState(serial, await this.client.state(serial, options));
  }

  async readOperating(serial) {
    const record = this.records.get(serial);
    const battery = batteryOf(await this.client.operating(serial), record.tool);
    record.operatingAt = this.now();
    if (battery !== null) {
      record.battery = battery;
    }
  }

  async readNextMow(serial) {
    const record = this.records.get(serial);
    record.nextMow = nextMowOf(await this.client.nextMow(serial));
    record.nextMowRead = true;
    record.nextMowAt = this.now();
  }

  async readAlerts() {
    const alerts = alertsOf(await this.client.alerts());
    this.alertsAt = this.now();
    this.alertsWanted = false;
    const only = this.records.size === 1 ? [...this.records.keys()][0] : null;
    const serialOf = (alert) => alert.serial ?? only;
    for (const record of this.records.values()) {
      const own = alerts.filter((a) => serialOf(a) === record.serial);
      record.alertsRead = true;
      record.alertsUnread = own.filter((a) => !a.read).length;
      record.lastAlert = own[0] ?? null;
    }
    const seen = this.alertsSeen;
    this.alertsSeen = new Set(alerts.map((a) => a.id));
    if (seen === null) {
      return;
    }
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    for (const alert of alerts.filter((a) => !seen.has(a.id) && !a.read).reverse()) {
      const serial = serialOf(alert);
      const record = serial ? this.records.get(serial) : undefined;
      if (!record) {
        continue;
      }
      const deviceId = ids.mower(this.gladys, serial);
      await this.gladys
        .publishSceneEvent(SCENE_TRIGGERS.ALERT, {
          mower: created.has(deviceId) ? deviceId : '',
          mower_name: this.nameOf(record),
          code: alert.code,
          headline: alert.headline,
          message: alert.message,
          flag: alert.flag,
        })
        .catch((err) => this.logger.warn(`Scene event failed: ${err.message}`));
    }
  }

  /**
   * A secondary read (battery, next mowing, alerts): its failure never
   * stops the round. It is logged and tried again on its own back-off; only
   * a 429 or a refused session goes up.
   */
  async secondary(key, now, full, read) {
    const retry = this.secondaryRetry.get(key);
    if (!full && retry && now < retry.at) {
      return;
    }
    try {
      await read();
      this.secondaryRetry.delete(key);
    } catch (err) {
      if (err.code === 'rate_limited' || isFinal(err)) {
        throw err;
      }
      const failures = (retry?.failures ?? 0) + 1;
      this.secondaryRetry.set(key, {
        failures,
        at: now + BACKOFF[Math.min(failures - 1, BACKOFF.length - 1)],
      });
      this.logger.warn(`${key}: ${reasonOf(err)}`);
    }
  }

  /**
   * One round of reads, each when it is due (all of them with `full`). The
   * list and the state are the main data: their failure stops the round;
   * what was read is published anyway.
   */
  async refresh({ full = false } = {}) {
    const now = this.now();
    try {
      if (
        full ||
        now - this.lastListAt >= (this.records.size === 0 ? SLOW_INTERVAL : LIST_INTERVAL)
      ) {
        await this.readList();
      }
      const poll = this.config.pollMinutes * 60_000;
      for (const record of [...this.records.values()]) {
        const activity = activityOf(record.code);
        if (
          full ||
          ((!this.config.longpoll || ACTIVE.has(activity)) && now - record.stateAt >= poll)
        ) {
          await this.readState(record.serial);
        }
        const id = safeId(record.serial);
        const busy = ACTIVE.has(activityOf(record.code)) || activityOf(record.code) === 'charging';
        if (full || now - record.operatingAt >= (busy ? OPERATING_ACTIVE : OPERATING_IDLE)) {
          await this.secondary(`Battery of ${id}`, now, full, () =>
            this.readOperating(record.serial),
          );
        }
        if (full || now - record.nextMowAt >= SLOW_INTERVAL) {
          await this.secondary(`Next mowing of ${id}`, now, full, () =>
            this.readNextMow(record.serial),
          );
        }
      }
      if (
        this.records.size > 0 &&
        (full || this.alertsWanted || now - this.alertsAt >= SLOW_INTERVAL)
      ) {
        await this.secondary('Alerts', now, full, () => this.readAlerts());
      }
      this.healthy = true;
      this.failures = 0;
      this.nextTryAt = 0;
    } finally {
      await this.publish([...this.records.keys()]);
    }
  }

  tick() {
    if (!this.ticking) {
      this.ticking = this.doTick().finally(() => {
        this.ticking = undefined;
      });
    }
    return this.ticking;
  }

  async doTick() {
    const now = this.now();
    if (this.fatal || now < this.pausedUntil || now < this.nextTryAt) {
      return;
    }
    try {
      await this.auth.renewIfDue();
    } catch (err) {
      await this.failed(err);
      return;
    }
    if (this.auth.expired) {
      this.healthy = false;
      const reason = reasonOf(this.auth.lastFailure ?? 'not yet');
      await this.setStatus(
        false,
        T.renewalRetry(reason, Math.max(0, this.auth.retryAt - this.now())),
      );
      return;
    }
    try {
      await this.refresh();
      await this.reportOk();
    } catch (err) {
      await this.failed(err);
    }
  }

  // --- Long poll -----------------------------------------------------------------------

  scheduleLongpoll(serial, delay) {
    this.timers.clearTimeout(this.longpollTimers.get(serial));
    const generation = this.generation;
    this.longpollTimers.set(
      serial,
      this.timers.setTimeout(
        () => {
          this.longpollTimers.delete(serial);
          return this.longpoll(serial, generation).catch((err) =>
            this.logger.warn(`Long poll failed: ${err.message}`),
          );
        },
        Math.max(0, delay),
      ),
    );
  }

  /** One long poll of a mower's state, then the next one is scheduled. */
  async longpoll(serial, generation) {
    const current = () => generation === this.generation && !this.fatal && this.records.has(serial);
    if (!current()) {
      return;
    }
    const started = this.now();
    if (started < this.pausedUntil) {
      this.scheduleLongpoll(serial, this.pausedUntil - started);
      return;
    }
    let delay;
    // stop() cancels it: a restart never leaves a request held for 4 minutes.
    const controller = new AbortController();
    this.longpollAborts.set(serial, controller);
    try {
      const data = await this.client.state(serial, {
        longpoll: true,
        last: this.records.get(serial).code ?? 0,
        signal: controller.signal,
      });
      if (!current()) {
        return;
      }
      this.longpollFailures.set(serial, 0);
      if (this.applyState(serial, data)) {
        await this.publish([serial]);
      }
      delay = LONGPOLL_MIN_GAP - (this.now() - started);
    } catch (err) {
      if (!current()) {
        return;
      }
      if (isFinal(err) || err.code === 'rate_limited') {
        await this.failed(err);
        if (this.fatal) {
          return;
        }
        delay = this.pausedUntil - this.now();
      } else {
        const failures = (this.longpollFailures.get(serial) ?? 0) + 1;
        this.longpollFailures.set(serial, failures);
        this.logger.warn(`Long poll of ${safeId(serial)}: ${reasonOf(err)}`);
        delay = BACKOFF[Math.min(failures - 1, BACKOFF.length - 1)];
      }
    } finally {
      if (this.longpollAborts.get(serial) === controller) {
        this.longpollAborts.delete(serial);
      }
    }
    if (current()) {
      this.scheduleLongpoll(serial, delay);
    }
  }

  // --- Publishing ----------------------------------------------------------------------

  nameOf(record) {
    return record.name ?? `Indego ${record.serial}`;
  }

  /** The plain mower of a record (what devices.js reads). */
  mowerOf(serial) {
    const record = this.records.get(serial);
    const activity = activityOf(record.code);
    return {
      serial,
      name: this.nameOf(record),
      model: record.model,
      firmware: record.firmware,
      code: record.code,
      activity,
      stateText: T.stateText(record.code, activity),
      mowed: record.mowed,
      battery: record.battery,
      nextMow: record.nextMow,
      nextMowRead: record.nextMowRead,
      alertsRead: record.alertsRead,
      alertsUnread: record.alertsUnread,
      lastAlert: record.lastAlert,
    };
  }

  /** The states of the created devices. No API call. */
  async publish(serials) {
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const states = [];
    for (const serial of serials) {
      if (!this.records.has(serial)) {
        continue;
      }
      const deviceId = ids.mower(this.gladys, serial);
      if (created.has(deviceId)) {
        states.push(...mowerStates(deviceId, this.mowerOf(serial), this.config.language));
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: 60 * 60_000 });
    } catch (err) {
      this.logger.warn(`States failed: ${err.message}`);
    }
  }

  async publishDevices() {
    await this.gladys.publishDiscoveredDevices(
      [...this.records.keys()].map((serial) =>
        buildMowerDevice(this.gladys, this.mowerOf(serial), this.config.language),
      ),
    );
  }

  // --- Discovery ---------------------------------------------------------------------

  /** The user asked for a scan: read the account again (a new mower, a renamed one). */
  async scan() {
    if (this.auth.signedIn && !this.fatal && this.now() >= this.pausedUntil) {
      try {
        await this.readList();
        return;
      } catch (err) {
        await this.failed(err);
      }
    }
    await this.publishDevices();
  }

  /** A device was created: the SDK forgot its states, publish them now. */
  async deviceCreated() {
    await this.publish([...this.records.keys()]);
  }

  // --- Sign-in ---------------------------------------------------------------------------

  /** The Connect button (account_link): the sign-in address. */
  authorizeUrl(key) {
    if (key !== ACCOUNT_KEY) {
      throw new Error(`Unknown account field ${key}`);
    }
    return this.auth.beginSignIn();
  }

  /** The "Start the sign-in" action: the address and what to do with it. */
  startSignIn() {
    return T.signInStarted(this.auth.beginSignIn());
  }

  /** The "Finish the sign-in" action: the address the sign-in ended on, pasted. */
  async finishSignIn(fields = {}) {
    try {
      await this.auth.finishSignIn(fields.url);
    } catch (err) {
      if (err.code === 'sign_in') {
        return { truncated: T.truncated, unknown_sign_in: T.unknownSignIn }[err.kind] ?? T.noCode;
      }
      if (err.code === 'refused') {
        return err.kind === 'cancelled' ? T.signInCancelled : T.signInFailed(err.detail);
      }
      return T.signInUnreachable(reasonOf(err));
    }
    this.logger.info('Signed in to Bosch');
    this.lastStatus = undefined;
    // Answer at once (the reads can take long); the status follows.
    this.restart();
    return T.signedInStarting;
  }

  /** Start again in the background, with the configuration Gladys holds. */
  restart() {
    this.starting = this.start(this.gladys.config ?? {}).catch((err) =>
      this.logger.error(`Start failed: ${err.message}`),
    );
    return this.starting;
  }

  // --- Commands ------------------------------------------------------------------------

  /** The record of a device external id. */
  recordFor(externalId) {
    const part = parseExternalId(externalId);
    for (const record of this.records.values()) {
      if (part !== undefined && safeId(record.serial) === part) {
        return record;
      }
    }
    throw this.say(T.unknownMower(externalId));
  }

  /** An error whose message is a text in the configured language (Gladys shows it). */
  say(text, cause) {
    return new Error(pick(text, this.config.language), cause ? { cause } : undefined);
  }

  /** One command at a time per mower; the others wait their turn (within their own budget). */
  serialize(serial, fn) {
    const run = (this.queues.get(serial) ?? Promise.resolve()).then(fn, fn);
    this.queues.set(
      serial,
      run.catch(() => {}),
    );
    return run;
  }

  /** Gladys command: the run mode select (Clean: mow, Idle: pause) or the dock button. */
  setValue(device, feature, value) {
    // Gladys shows a failure after 5 s: the budget starts now, queue included.
    const deadline = this.now() + ACK_BUDGET;
    const key = featureKeyOf(feature.external_id);
    let command;
    if (key === FEATURE.RUN_MODE) {
      const mode = Number(value);
      if (mode === RUN_MODE.CLEANING) {
        command = COMMANDS.MOW;
      } else if (mode === RUN_MODE.IDLE) {
        command = COMMANDS.PAUSE;
      } else {
        return Promise.reject(new Error(`Run mode ${value} is not supported by a mower`));
      }
    } else if (key === FEATURE.DOCK) {
      command = COMMANDS.DOCK;
    } else {
      return Promise.reject(new Error(`${feature.external_id} is not a command`));
    }
    let record;
    try {
      record = this.recordFor(device.external_id);
    } catch (err) {
      return Promise.reject(err);
    }
    return this.serialize(record.serial, () =>
      this.runCommand(record.serial, command, deadline, feature.external_id),
    );
  }

  /**
   * Read the state right before acting (never decide on the state in
   * memory), refuse when it cannot be read or when the budget is spent,
   * skip a command that changes nothing, send, then read the state back.
   */
  async runCommand(serial, command, deadline, featureId) {
    if (!this.auth.signedIn) {
      throw this.say(T.notSignedInCommand);
    }
    if (this.fatal) {
      throw this.say(T.refusedCommand);
    }
    let now = this.now();
    if (now < this.pausedUntil) {
      throw this.say(T.commandRateLimited(this.pausedUntil - now));
    }
    if (this.auth.expired) {
      throw this.say(T.commandSession);
    }
    const budget = deadline - now - SEND_RESERVE;
    if (budget < 300) {
      throw this.say(T.commandTooSlow);
    }
    let data;
    try {
      data = await this.client.state(serial, { timeout: budget, renew: false });
    } catch (err) {
      if (err.code === 'rate_limited' || isFinal(err)) {
        await this.failed(err);
      }
      throw this.say(T.commandStateUnknown(reasonOf(err)), err);
    }
    if (!this.records.has(serial) || !this.applyState(serial, data)) {
      throw this.say(T.commandStateUnknown('no state in the answer'));
    }
    const activity = activityOf(this.records.get(serial).code);
    if (activity === 'offline') {
      this.publish([serial]).catch(() => {});
      throw this.say(T.commandOffline);
    }
    // Gladys shows the requested mode at once: let the next publication re-send the real one.
    this.gladys.forgetPublishedStates(featureId);
    const guard = this.activeGuard(serial);
    if (SKIPPABLE[command]?.has(activity) && !(guard && guard.command !== command)) {
      this.logger.info(`${safeId(serial)}: ${command} skipped, already ${activity}`);
      this.publish([serial]).catch(() => {});
      return;
    }
    now = this.now();
    if (deadline - now < SEND_RESERVE) {
      this.publish([serial]).catch(() => {});
      throw this.say(T.commandTooSlow);
    }
    // The request keeps its full timeout: it is never cut once sent. Gladys
    // only waits until the deadline for the answer.
    const put = this.client.command(serial, command);
    this.guards.set(serial, {
      command,
      at: now,
      startCode: this.records.get(serial).code,
      moved: false,
    });
    // Sent or not, the state tells: read it back.
    this.scheduleReadBack(serial);
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve('late'), Math.max(0, deadline - now));
    });
    let outcome;
    try {
      outcome = await Promise.race([put.then(() => 'ok'), late]);
    } catch (err) {
      await this.commandFailed(serial, command, err);
      // A network failure or a timeout may come after the cloud got it.
      throw this.say(
        err.code === 'unreachable' ? T.commandUnconfirmed : T.commandFailed(reasonOf(err)),
        err,
      );
    } finally {
      this.timers.clearTimeout(timer);
    }
    if (outcome === 'late') {
      put.then(
        () => this.logger.info(`${safeId(serial)}: ${command} (confirmed late)`),
        (err) => this.commandFailed(serial, command, err),
      );
      throw this.say(T.commandUnconfirmed);
    }
    this.logger.info(`${safeId(serial)}: ${command}`);
  }

  /** The guard of a mower, while it stands. */
  activeGuard(serial) {
    const guard = this.guards.get(serial);
    if (guard && this.now() - guard.at >= GUARD_TTL) {
      this.guards.delete(serial);
      return undefined;
    }
    return guard;
  }

  async commandFailed(serial, command, err) {
    this.logger.warn(`${safeId(serial)}: ${command} failed (${reasonOf(err)})`);
    if (err.code === 'rate_limited' || isFinal(err)) {
      await this.failed(err);
    }
  }

  scheduleReadBack(serial) {
    for (const timer of this.readBackTimers.get(serial) ?? []) {
      this.timers.clearTimeout(timer);
    }
    const generation = this.generation;
    this.readBackTimers.set(
      serial,
      READ_BACK.map((delay) =>
        this.timers.setTimeout(() => this.readBack(serial, generation), delay),
      ),
    );
  }

  async readBack(serial, generation) {
    if (generation !== this.generation || this.fatal || !this.records.has(serial)) {
      return;
    }
    if (this.now() < this.pausedUntil) {
      return;
    }
    try {
      await this.readState(serial);
      await this.publish([serial]);
    } catch (err) {
      if (err.code === 'rate_limited' || isFinal(err)) {
        await this.failed(err);
      } else {
        this.logger.warn(`Read back of ${safeId(serial)} failed: ${reasonOf(err)}`);
      }
    }
  }

  // --- Configuration screen button --------------------------------------------------

  async testConnection() {
    if (!this.auth.signedIn) {
      return T.notSignedIn;
    }
    if (this.auth.refused) {
      return T.refused;
    }
    const now = this.now();
    if (now < this.pausedUntil) {
      return T.rateLimited(this.pausedUntil - now);
    }
    if (this.fatal || !this.tickTimer) {
      // Never started (or stopped): start for real, in the background.
      this.restart();
      return T.starting;
    }
    try {
      await this.refresh({ full: true });
      await this.reportOk();
    } catch (err) {
      await this.failed(err);
    }
    if (this.fatal) {
      return isFinal(this.fatal) ? T.refused : T.unreachable(reasonOf(this.fatal));
    }
    if (!this.healthy) {
      return this.now() < this.pausedUntil
        ? T.rateLimited(this.pausedUntil - this.now())
        : T.unreachable('see the connection status');
    }
    return T.test([...this.records.keys()].map((serial) => this.mowerOf(serial)));
  }
}
