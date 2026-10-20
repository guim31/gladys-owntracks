// -----------------------------------------------------------------------------
// The hub: the link to one OwnTracks Recorder, and everything Gladys sees of
// it — devices, states, connection status, scene events, the presence pings.
//
// Live updates come from the WebSocket `/ws/last`. While it is down, the REST
// API (`/api/0/last`) is read every `fallbackInterval`; every (re)opening of
// the socket reads it too, so nothing missed during an outage is lost: a
// region crossed meanwhile still fires its trigger, late.
//
// Region triggers come from two sources that agree: the `transition` messages
// the app sends when it enters or leaves a region (pushed live only), and the
// `inregions` list of each location (also in the REST snapshot). A region is
// entered once whatever the source says it first.
//
// Coordinates never reach the logs, and reach Gladys (map links) only when
// the user enables `share_coordinates`.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured } from './config.js';
import { buildDevice, buildStates, deviceIds, featureKeyOf } from './devices.js';
import { homeModeOf, locationOf, mapUrl, ownerOf, phoneKey, regionsOf, viewOf } from './model.js';
import { RecorderClient, RecorderError } from './owntracks/client.js';
import { LiveLink } from './owntracks/socket.js';
import { formatTime, INIT_FAILED, STATUS_TEXT, TEST_TEXT } from './texts.js';

const logger = createLogger({ name: 'owntracks-hub' });

export const WIDGET_KEY = 'phones';

// Scene trigger keys (manifest `scene_triggers`).
export const TRIGGERS = {
  arrival: 'home_arrival',
  departure: 'home_departure',
  enter: 'region_enter',
  exit: 'region_exit',
  stopped: 'tracking_stopped',
};

/** The silences the "No position received" trigger can wait for, in hours. */
export const SILENCE_HOURS = ['1', '2', '3', '6', '12', '24', '48'];

// Values that change with nearly every location of a moving phone.
const CONTINUOUS_KEYS = ['distance_home', 'battery', 'last_position'];

export const DEFAULT_TIMINGS = {
  // REST reads while the WebSocket is down.
  fallbackInterval: 60_000,
  // Presence pings and silences: checked every minute; pings sent every 5
  // minutes at most.
  minuteCheck: 60_000,
  presenceEvery: 5 * 60_000,
  // Unchanged values re-sent so Gladys never shows "no recent value".
  heartbeatCheck: 30 * 60_000,
  heartbeat: 11.5 * 60 * 60_000, // checked every 30 min: at most 12 h
  // Continuous values of one phone: at most one batch per period, so phones
  // in "move" mode (a location every few seconds) stay well under the 300
  // states a minute of the core. Region and at home go at once.
  continuousGap: 30_000,
  // While the Recorder (or its proxy) refuses the credentials: one try every
  // 10 minutes.
  unauthorizedRetry: 10 * 60_000,
  // requestWidgetRefresh is dropped by the core beyond one call per 10 s.
  widgetGap: 10_500,
};

const sameList = (a, b) => a.length === b.length && a.every((item, i) => item === b[i]);

export class Hub {
  constructor({ gladys, fetch, createSocket, timings, socketTimings, now = Date.now }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.createSocket = createSocket;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.socketTimings = socketTimings;
    this.now = now;

    this.config = null;
    this.client = null;
    this.link = null;
    this.version = null;
    /** @type {Map<string, object>} key `user/device` -> phone */
    this.phones = new Map();
    this.house = null;
    this.problem = null; // the code of the current Recorder problem, null when fine
    this.reported = undefined; // the last connection status sent to Gladys
    this.lastDevicesSignature = '';
    this.lastPresence = new Map();
    this.timers = [];
    this.queue = Promise.resolve();
    this.widgetTimer = null;
    this.lastWidgetRefresh = 0;
    this.stopped = false;
    // Incremented by every stop(): work queued or awaited for an older
    // configuration checks it and gives up.
    this.generation = 0;
    this.lifecycle = Promise.resolve();
    this.lastContinuous = new Map();
    this.continuousTimers = new Map();
    this.publishFailing = false;
    this.lastUnauthorizedTry = 0;
    this.warnedRegion = null;
  }

  // --- lifecycle -------------------------------------------------------------

  async start(config) {
    this.stopped = false;
    this.config = config;
    const generation = this.generation;
    await this.#loadHouse();
    if (generation !== this.generation) {
      return;
    }
    if (!isConfigured(config)) {
      this.phones.clear();
      await this.publishDevices({ force: true });
      await this.#reportStatus(config.invalidUrl ? 'invalid_url' : 'not_configured');
      return;
    }
    this.client = this.#newClient();
    await this.#serialized(() => this.#refresh({ initial: true }));
    if (generation !== this.generation) {
      return; // stopped or reconfigured meanwhile
    }
    this.link = new LiveLink({
      client: this.client,
      createSocket: this.createSocket,
      timings: this.socketTimings,
    });
    this.link.on('open', () => this.#onLiveOpen());
    this.link.on('message', (message) => this.#serialized(() => this.#onMessage(message)));
    this.link.on('close', () => logger.debug('Live link closed, REST fallback until it is back'));
    this.link.start();
    this.#every(this.timings.fallbackInterval, () => {
      if (this.link?.live) {
        return undefined;
      }
      if (
        this.problem === 'unauthorized' &&
        this.now() - this.lastUnauthorizedTry < this.timings.unauthorizedRetry
      ) {
        return undefined; // do not hammer the proxy with refused logins
      }
      return this.#serialized(() => this.#refresh());
    });
    this.#every(this.timings.minuteCheck, () =>
      this.#serialized(async () => {
        await this.#pingPresences();
        await this.#checkSilences();
      }),
    );
    this.#every(this.timings.heartbeatCheck, () =>
      this.publishAllStates({ heartbeat: this.timings.heartbeat }),
    );
  }

  #newClient() {
    return new RecorderClient({
      url: this.config.url,
      username: this.config.username,
      password: this.config.password,
      fetch: this.fetch,
    });
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    for (const timer of this.continuousTimers.values()) {
      clearTimeout(timer);
    }
    this.continuousTimers.clear();
    this.link?.stop();
    this.link = null;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    clearTimeout(this.widgetTimer);
    this.widgetTimer = null;
  }

  /** The configuration changed: start over (the devices keep their ids). */
  reconfigure(config) {
    // One lifecycle change at a time (two quick saves, a Gladys reconnection
    // during a save): each waits for the previous one.
    const run = this.lifecycle.then(() => this.#restart(config));
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async #restart(config) {
    this.stop();
    this.phones.clear();
    this.lastPresence.clear();
    this.lastContinuous.clear();
    this.version = null;
    this.problem = null;
    this.lastDevicesSignature = '';
    this.gladys.forgetPublishedStates?.();
    await this.start(config);
    this.refreshWidget();
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync(config) {
    this.reported = undefined;
    await this.reconfigure(config);
  }

  #every(interval, fn) {
    const timer = setInterval(() => {
      Promise.resolve()
        .then(fn)
        .catch((err) => logger.error('Periodic task failed', err));
    }, interval);
    timer.unref?.();
    this.timers.push(timer);
  }

  /** Runs fn after the previous messages and refreshes: states stay in order. */
  #serialized(fn) {
    const generation = this.generation;
    const run = this.queue.then(() =>
      this.stopped || generation !== this.generation ? undefined : fn(),
    );
    this.queue = run.catch((err) => logger.error('OwnTracks update failed', err));
    return run;
  }

  // --- Gladys house ----------------------------------------------------------

  async #loadHouse() {
    let houses = [];
    try {
      houses = await this.gladys.getHouses();
    } catch (err) {
      logger.warn(`Cannot read the Gladys houses (${err.message}): no distance from home`);
    }
    const located = (houses ?? []).filter(
      (house) => typeof house.latitude === 'number' && typeof house.longitude === 'number',
    );
    const wanted = this.config.house.toLowerCase();
    const house =
      (wanted && located.find((h) => String(h.name).toLowerCase() === wanted)) || located[0];
    if (wanted && house && String(house.name).toLowerCase() !== wanted) {
      logger.warn(`No located Gladys house named "${this.config.house}", using "${house.name}"`);
    }
    this.house = house
      ? { name: house.name, latitude: house.latitude, longitude: house.longitude }
      : null;
  }

  // --- Recorder -> state -----------------------------------------------------

  /** Reads the REST snapshot (latest location of every phone) and applies it. */
  async #refresh({ initial = false } = {}) {
    if (this.problem === 'unauthorized') {
      this.lastUnauthorizedTry = this.now();
    }
    let structure = initial;
    try {
      const recovering = initial || this.problem !== null;
      const [last, version] = await Promise.all([
        this.client.getLast(),
        recovering ? this.client.getVersion().catch(() => null) : null,
      ]);
      if (version) {
        this.version = version.version ?? null;
      }
      const seen = new Set();
      for (const message of last) {
        const owner = ownerOf(message);
        if (!owner) {
          continue;
        }
        seen.add(phoneKey(owner.user, owner.device));
        structure = (await this.#applyLocation(message, owner)) || structure;
      }
      for (const key of [...this.phones.keys()]) {
        if (!seen.has(key)) {
          this.phones.delete(key);
          this.lastPresence.delete(key);
          structure = true;
        }
      }
    } catch (err) {
      await this.#failed(err);
      return;
    }
    this.#checkHomeRegion();
    await this.#recovered(initial);
    await this.publishDevices({ force: structure });
    await this.publishAllStates();
    this.refreshWidget();
  }

  /** A home region no phone has ever been in: said once per name, in debug. */
  #checkHomeRegion() {
    const wanted = this.config.homeRegion;
    if (!wanted || this.warnedRegion === wanted) {
      return;
    }
    const known = [...this.phones.values()].some((phone) =>
      phone.regions.some((name) => name.toLowerCase() === wanted.toLowerCase()),
    );
    if (!known) {
      this.warnedRegion = wanted;
      logger.debug('No phone is in the home region right now');
    }
  }

  async #onLiveOpen() {
    logger.debug('Live link open');
    // Catch up with what happened while the socket was down.
    await this.#serialized(() => this.#refresh());
  }

  async #onMessage(message) {
    const owner = ownerOf(message);
    if (!owner) {
      return;
    }
    const key = phoneKey(owner.user, owner.device);
    if (message._type === 'location') {
      const isNew = await this.#applyLocation(message, owner);
      if (isNew) {
        await this.publishDevices();
      }
      await this.#publishPhone(key);
    } else if (message._type === 'transition') {
      if (await this.#applyTransition(message, owner)) {
        await this.#publishPhone(key);
      }
    }
  }

  #phone(owner, create) {
    const key = phoneKey(owner.user, owner.device);
    let phone = this.phones.get(key);
    if (!phone && create) {
      phone = {
        user: owner.user,
        device: owner.device,
        card: null,
        location: null,
        regions: [],
        reportsRegions: false,
        silence: new Set(),
      };
      this.phones.set(key, phone);
    }
    return phone;
  }

  /**
   * A location (live or from the snapshot).
   * @returns {boolean} whether the device structure changed (new phone, new name)
   */
  async #applyLocation(message, owner) {
    let structure = !this.phones.has(phoneKey(owner.user, owner.device));
    const phone = this.#phone(owner, true);
    if (typeof message.name === 'string' && message.name.trim()) {
      const card = message.name.trim();
      structure ||= phone.card !== card;
      phone.card = card;
    }
    const location = locationOf(message);
    if (!location) {
      return structure;
    }
    const previous = phone.location;
    if (previous && location.time <= previous.time) {
      return structure; // the same location again (snapshot after a reconnection)
    }
    const before = previous ? this.view(phone) : null;
    const regionsBefore = phone.regions;
    const regions = regionsOf(message);
    if (regions !== null) {
      phone.reportsRegions = true;
      phone.regions = regions;
    } else if (phone.reportsRegions) {
      // The app sends `inregions` and left it out: in no region.
      phone.regions = [];
    }
    phone.location = location;
    // A new position ends a silence; an old one (read at start) is a silence
    // that began before: not announced.
    phone.silence = this.#crossedSilences(location.time);
    if (!before) {
      return structure; // the first location known: nothing to compare with
    }
    await this.#fireRegions(phone, regionsBefore, phone.regions);
    await this.#afterMove(phone, before);
    return structure;
  }

  /** @returns {boolean} whether the regions of the phone changed */
  async #applyTransition(message, owner) {
    const phone = this.#phone(owner, false);
    const region = typeof message.desc === 'string' ? message.desc.trim() : '';
    if (!phone?.location || !region || !['enter', 'leave'].includes(message.event)) {
      return false; // the location that follows will tell
    }
    if (Number.isFinite(message.tst) && message.tst * 1000 < phone.location.time) {
      return false; // older than what the latest location already says
    }
    const inside = phone.regions.includes(region);
    if ((message.event === 'enter') === inside) {
      return false;
    }
    const before = this.view(phone);
    const regionsBefore = phone.regions;
    phone.regions =
      message.event === 'enter'
        ? [...phone.regions, region]
        : phone.regions.filter((name) => name !== region);
    await this.#fireRegions(phone, regionsBefore, phone.regions);
    await this.#afterMove(phone, before);
    return true;
  }

  async #fireRegions(phone, before, after) {
    if (sameList(before, after)) {
      return;
    }
    const view = this.view(phone);
    const common = {
      time: formatTime(view.time, this.config.language, this.now()),
      map_url: this.#mapUrl(view),
    };
    for (const region of before.filter((name) => !after.includes(name))) {
      await this.#fire(TRIGGERS.exit, phone, { region, ...common });
    }
    for (const region of after.filter((name) => !before.includes(name))) {
      await this.#fire(TRIGGERS.enter, phone, { region, ...common });
    }
    this.refreshWidget();
  }

  /** Arrival and departure, and the presence ping, after a move. */
  async #afterMove(phone, before) {
    const view = this.view(phone);
    if (before.atHome !== null && view.atHome !== null && before.atHome !== view.atHome) {
      logger.debug(`Phone ${view.key}: ${view.atHome ? 'arrived home' : 'left home'}`);
      await this.#fire(view.atHome ? TRIGGERS.arrival : TRIGGERS.departure, phone, {
        time: formatTime(view.time, this.config.language, this.now()),
      });
      this.refreshWidget();
    }
    if (view.atHome) {
      await this.#pingPresence(phone, view, { force: true });
    }
  }

  #crossedSilences(time) {
    const age = this.now() - time;
    return new Set(SILENCE_HOURS.filter((hours) => age >= Number(hours) * 3_600_000));
  }

  async #checkSilences() {
    for (const phone of this.phones.values()) {
      if (!phone.location) {
        continue;
      }
      for (const hours of this.#crossedSilences(phone.location.time)) {
        if (phone.silence.has(hours)) {
          continue;
        }
        phone.silence.add(hours);
        await this.#fire(TRIGGERS.stopped, phone, {
          hours,
          last_position: formatTime(phone.location.time, this.config.language, this.now()),
        });
      }
    }
  }

  #mapUrl(view) {
    return this.config.shareCoordinates ? mapUrl(view) : '';
  }

  #createdDevice(phone) {
    const id = deviceIds(this.gladys, phone.user, phone.device).device;
    return (this.gladys.devices ?? []).find((device) => device.external_id === id) ?? null;
  }

  view(phone) {
    return viewOf(phone, { house: this.house, config: this.config });
  }

  /** The phone of a Gladys device external id, or null. */
  phoneOf(externalId) {
    for (const phone of this.phones.values()) {
      if (deviceIds(this.gladys, phone.user, phone.device).device === externalId) {
        return phone;
      }
    }
    return null;
  }

  // --- scene events ----------------------------------------------------------

  async #fire(key, phone, data) {
    // Only the phones added to Gladys fire: a scene "any phone" must not run
    // for one the user left out.
    if (!this.#createdDevice(phone)) {
      return;
    }
    const event = {
      device: deviceIds(this.gladys, phone.user, phone.device).device,
      phone: this.view(phone).name,
      ...data,
    };
    logger.debug(`Scene event ${key} for phone ${phoneKey(phone.user, phone.device)}`);
    try {
      await this.gladys.publishSceneEvent(key, event);
    } catch (err) {
      logger.error(`Scene event ${key} refused by Gladys`, err);
    }
  }

  // --- presence --------------------------------------------------------------

  async #pingPresences() {
    for (const phone of this.phones.values()) {
      const view = this.view(phone);
      if (view.atHome) {
        await this.#pingPresence(phone, view);
      }
    }
  }

  /**
   * "Seen at home": a presence-sensor/push value, at each location at home
   * and then every 5 minutes while the last location is recent enough. A
   * phone that stopped reporting stops pinging, and Gladys' "Check user
   * presence" marks the user away after the delay chosen in the scene.
   */
  async #pingPresence(phone, view, { force = false } = {}) {
    const created = this.#createdDevice(phone);
    const ids = deviceIds(this.gladys, phone.user, phone.device);
    if (!created?.features?.some((f) => f.external_id === ids.feature('presence'))) {
      return;
    }
    const now = this.now();
    if (view.time === null || now - view.time > this.config.presenceMaxAge * 60_000) {
      return;
    }
    const key = view.key;
    const last = this.lastPresence.get(key) ?? 0;
    if (!force && now - last < this.timings.presenceEvery) {
      return;
    }
    if (force && now - last < 60_000) {
      return; // several locations in a row at home: one ping a minute is plenty
    }
    this.lastPresence.set(key, now);
    try {
      await this.gladys.publishState(ids.feature('presence'), 1);
    } catch (err) {
      logger.warn(`Presence of phone ${key} not sent (${err.message})`);
    }
  }

  // --- Gladys publishing -----------------------------------------------------

  /** The discovered devices; only sent again when their structure changed. */
  async publishDevices({ force = false } = {}) {
    const hasHouse = this.house !== null;
    const hasHome = this.config ? homeModeOf(this.config, this.house) !== null : false;
    const devices = [...this.phones.values()]
      .map((phone) => this.view(phone))
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((view) =>
        buildDevice(this.gladys, view, {
          language: this.config?.language ?? 'fr',
          hasHouse,
          hasHome,
        }),
      );
    const signature = JSON.stringify(devices);
    if (!force && signature === this.lastDevicesSignature) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.lastDevicesSignature = signature;
    } catch (err) {
      logger.warn(`Devices not accepted by Gladys (${err.message}), sent again next time`);
    }
  }

  /** The states of one phone, for the features its Gladys device has. */
  #statesOf(phone) {
    const created = this.#createdDevice(phone);
    if (!created) {
      return [];
    }
    const keys = new Set((created.features ?? []).map((f) => featureKeyOf(f.external_id)));
    return buildStates(this.gladys, this.view(phone), { language: this.config.language, keys });
  }

  /**
   * The live states of a phone: the continuous values at most once per
   * `continuousGap` (the latest then sent by a timer), the rest at once.
   */
  async #publishPhone(key) {
    const phone = this.phones.get(key);
    if (!phone) {
      return;
    }
    const states = this.#statesOf(phone);
    const now = this.now();
    if (now - (this.lastContinuous.get(key) ?? 0) >= this.timings.continuousGap) {
      this.lastContinuous.set(key, now);
      await this.#publish(states);
      return;
    }
    await this.#publish(
      states.filter((s) => !CONTINUOUS_KEYS.includes(featureKeyOf(s.device_feature_external_id))),
    );
    if (!this.continuousTimers.has(key)) {
      const wait = this.lastContinuous.get(key) + this.timings.continuousGap - now;
      const timer = setTimeout(() => {
        this.continuousTimers.delete(key);
        this.#serialized(() => this.#publishPhone(key));
      }, wait);
      timer.unref?.();
      this.continuousTimers.set(key, timer);
    }
  }

  async publishAllStates(options) {
    const states = [...this.phones.values()].flatMap((phone) => this.#statesOf(phone));
    await this.#publish(states, options);
  }

  async #publish(states, options) {
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, options);
      if (this.publishFailing) {
        this.publishFailing = false;
        logger.info('Gladys accepts the states again');
      }
    } catch (err) {
      if (!this.publishFailing) {
        this.publishFailing = true;
        logger.warn(`States not accepted by Gladys (${err.message}), sent again next time`);
      } else {
        logger.debug(`States still refused (${err.message})`);
      }
    }
  }

  /** A device was added in Gladys: its states, and the widget. */
  async onDeviceCreated(device) {
    await this.#serialized(async () => {
      const phone = this.phoneOf(device?.external_id);
      if (phone) {
        this.gladys.forgetPublishedStates?.(device.external_id);
        await this.#publish(this.#statesOf(phone));
        const view = this.view(phone);
        if (view.atHome) {
          this.lastPresence.delete(view.key);
          await this.#pingPresence(phone, view);
        }
      }
    });
    this.refreshWidget({ now: true });
  }

  /** onPoll fallback (the devices say should_poll: false). */
  async poll(device) {
    const phone = this.phoneOf(device?.external_id);
    if (phone) {
      await this.#publish(this.#statesOf(phone));
    }
  }

  async scan() {
    await this.publishDevices({ force: true });
  }

  /** requestWidgetRefresh, at most once every 10 s (later calls are merged). */
  refreshWidget({ now = false } = {}) {
    if (this.stopped) {
      return;
    }
    const wait = this.lastWidgetRefresh + this.timings.widgetGap - this.now();
    if (now || wait <= 0) {
      clearTimeout(this.widgetTimer);
      this.widgetTimer = null;
      this.lastWidgetRefresh = this.now();
      Promise.resolve(this.gladys.requestWidgetRefresh(WIDGET_KEY)).catch(() => {});
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  // --- connection status -----------------------------------------------------

  async #failed(err) {
    const code = err instanceof RecorderError ? err.code : 'error';
    const status = ['unauthorized', 'unreachable'].includes(code) ? code : 'error';
    if (this.problem !== status) {
      // One line per outage, not one per attempt.
      logger.warn(`OwnTracks Recorder: ${err.message}`);
      this.problem = status;
    } else {
      logger.debug(`Recorder still failing: ${err.message}`);
    }
    await this.#reportStatus(status);
    if (this.phones.size === 0) {
      await this.publishDevices();
    }
  }

  async #recovered(initial) {
    if (this.problem !== null || initial) {
      logger.info(
        `${this.problem ? 'The Recorder is back' : 'Connected to OwnTracks Recorder'} ${this.version ?? '?'}: ${this.phones.size} phone(s)`,
      );
    }
    this.problem = null;
    await this.#reportStatus(null);
  }

  async #reportStatus(code) {
    if (this.reported === code) {
      return;
    }
    this.reported = code;
    try {
      if (code === null) {
        await this.gladys.setConnectionStatus(true);
      } else {
        const message = Object.fromEntries(
          Object.entries(STATUS_TEXT).map(([language, texts]) => [language, texts[code]]),
        );
        await this.gladys.setConnectionStatus(false, message);
      }
    } catch (err) {
      this.reported = undefined;
      logger.debug(`Connection status not sent (${err.message})`);
    }
  }

  async reportInitFailed() {
    await this.gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
  }

  // --- "Test the connection" button -------------------------------------------

  async testReport() {
    const config = this.config;
    const fail = (code) =>
      Object.fromEntries(Object.entries(STATUS_TEXT).map(([language, t]) => [language, t[code]]));
    if (!config || !isConfigured(config)) {
      return fail(config?.invalidUrl ? 'invalid_url' : 'not_configured');
    }
    const client = this.#newClient();
    try {
      const [version, users, last] = await Promise.all([
        client.getVersion(),
        client.getUsers(),
        client.getLast(),
      ]);
      logger.info('Connection test: success');
      const phones = last.filter((message) => ownerOf(message) && locationOf(message)).length;
      return Object.fromEntries(
        Object.entries(TEST_TEXT).map(([language, t]) => [
          language,
          t.ok(version?.version ?? '?', users.length, phones),
        ]),
      );
    } catch (err) {
      logger.info(`Connection test: ${err.message}`);
      const code = err instanceof RecorderError ? err.code : 'error';
      return fail(['unauthorized', 'unreachable'].includes(code) ? code : 'error');
    }
  }
}
