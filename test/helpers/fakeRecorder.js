// -----------------------------------------------------------------------------
// A fake OwnTracks Recorder on a fake network: the HTTP API (version, list,
// last) and the WebSocket /ws/last, served from the fixtures recorded on
// Recorder 1.0.4 (test/fixtures/recorder-1.0.4), with the optional Basic auth
// of a reverse proxy. Tests never touch the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const USER = 'proxy-user';
export const PASSWORD = 'test-password-not-a-secret';

export function fixture(name) {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/recorder-1.0.4/${name}`, import.meta.url), 'utf8'),
  );
}

/** Lets the pending promises and timers of zero delay run. */
export const settle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

// The fixture phones: alice/phone at home (region "Home"), bob/pixel 1 km away.
export const HOUSE_POINT = { lat: 48.8566, lon: 2.3522 };
export const WORK = { lat: 48.87, lon: 2.3 };
export const AWAY = { lat: 48.8601, lon: 2.3399 };
// The time of the fixtures: bob's last location is at 14:10:01 UTC.
export const START = Date.parse('2026-10-20T14:15:00Z');

class FakeSocket {
  constructor(server, headers) {
    this.server = server;
    this.headers = headers;
    this.listeners = {};
    this.closed = false;
    this.sent = [];
    setTimeout(() => {
      if (this.closed) {
        return;
      }
      if (!server.up || !server.authorized(headers)) {
        this.#close();
        return;
      }
      server.sockets.add(this);
      this.#emit('open', {});
    }, 1);
  }

  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  #emit(type, event) {
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }

  /** Client -> server: the Recorder echoes every text frame. */
  send(text) {
    this.sent.push(text);
    if (!this.server.mute) {
      this.push(text);
    }
  }

  /** Server -> client frame. */
  push(frame) {
    if (!this.closed) {
      this.#emit('message', { data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
    }
  }

  #close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.server.sockets.delete(this);
    this.#emit('close', { code: 1006 });
  }

  close() {
    this.#close();
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.host]
 * @param {boolean} [options.basicAuth] the proxy asks for USER / PASSWORD
 */
export function createRecorder({ host = '192.0.2.10', basicAuth = false, last } = {}) {
  const expected = basicAuth
    ? `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`
    : null;
  const recorder = {
    url: `http://${host}:8083`,
    last: structuredClone(last ?? fixture('last.json')),
    version: fixture('version.json'),
    up: true,
    mute: false,
    requests: [],
    sockets: new Set(),

    authorized(headers) {
      return expected === null || headers?.Authorization === expected;
    },

    async handle(url, init = {}) {
      const { pathname } = new URL(url);
      this.requests.push({ path: pathname, url });
      if (!this.up) {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      if (!this.authorized(init.headers)) {
        return new Response('401 Authorization Required', { status: 401 });
      }
      const users = [...new Set(this.last.map((l) => l.username))];
      const routes = {
        '/api/0/version': () => this.version,
        '/api/0/list': () => ({ results: users }),
        '/api/0/last': () => this.last,
      };
      const route = routes[pathname];
      return route ? Response.json(route()) : new Response('', { status: 404 });
    },

    /** Pushes a frame to every open socket. */
    push(frame) {
      for (const socket of this.sockets) {
        socket.push(frame);
      }
    },

    /** A message received from a phone: a location is stored as its last, both are pushed. */
    publish(message) {
      if (message._type === 'location') {
        const previous = this.last.find(
          (l) => l.username === message.username && l.device === message.device,
        );
        this.last = [
          ...this.last.filter(
            (l) => !(l.username === message.username && l.device === message.device),
          ),
          { ...message, ...(previous?.name ? { name: previous.name } : {}) },
        ];
      }
      this.push({ ...message, _label: 'OwnTracks' });
    },

    dropSockets() {
      for (const socket of [...this.sockets]) {
        socket.close();
      }
    },
  };
  return recorder;
}

/** The fetch and socket factory of a fake network holding these servers. */
export function network(...servers) {
  const find = (url) =>
    servers.find((s) => url.startsWith(s.url) || url.startsWith(s.url.replace(/^http/, 'ws')));
  return {
    fetch: async (url, init) => {
      const server = find(url);
      if (!server) {
        throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
      }
      return server.handle(url, init);
    },
    createSocket: (url, headers) => {
      const server = find(url);
      if (!server) {
        throw new Error('unreachable');
      }
      return new FakeSocket(server, headers);
    },
  };
}

let sequence = 0;

/** A location as the Recorder pushes it (`tst` in seconds, always newer). */
export function location(user, device, { lat, lon, tst, ...rest } = {}) {
  sequence += 1;
  return {
    _type: 'location',
    tid: user.slice(0, 2).toUpperCase(),
    lat,
    lon,
    acc: 10,
    batt: 70,
    vel: 0,
    tst: tst ?? Math.floor(START / 1000) + 600 + sequence,
    t: 'u',
    tzname: 'Europe/Paris',
    _http: true,
    topic: `owntracks/${user}/${device}`,
    username: user,
    device,
    ...rest,
  };
}

/** A region transition as the Recorder pushes it. */
export function transition(user, device, event, desc, { tst, ...rest } = {}) {
  sequence += 1;
  return {
    _type: 'transition',
    tid: user.slice(0, 2).toUpperCase(),
    lat: AWAY.lat,
    lon: AWAY.lon,
    acc: 20,
    tst: tst ?? Math.floor(START / 1000) + 600 + sequence,
    wtst: 1790000000,
    event,
    desc,
    t: 'c',
    topic: `owntracks/${user}/${device}`,
    username: user,
    device,
    ...rest,
  };
}
