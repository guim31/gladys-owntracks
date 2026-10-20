// -----------------------------------------------------------------------------
// The live link of the Recorder: the WebSocket `/ws/last`.
//
// Checked on Recorder 1.0.4: every location and transition the Recorder
// receives is pushed as one JSON object, with `username`, `device` and
// `topic` added (cards are not pushed). The server sends no keep-alive, and
// echoes back any text frame it receives: the link sends `ping` every
// `pingInterval`, so a dead connection (or a reverse proxy closing idle
// sockets) is noticed by the silence. Frames that are not JSON (the echoes)
// are ignored.
//
// Node 22+ ships WebSocket as a global, and accepts the `headers` option
// (Basic auth behind a proxy): no dependency needed.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'owntracks-live' });

export const DEFAULT_SOCKET_TIMINGS = {
  pingInterval: 30_000,
  idleTimeout: 95_000,
  reconnectMin: 2_000,
  reconnectMax: 120_000,
};

export function socketUrl(baseUrl) {
  return `${baseUrl.replace(/^http/i, 'ws')}/ws/last`;
}

/**
 * Emits `message` (each parsed object), `open` and `close`.
 * Reconnects by itself, with a growing delay, until stop().
 */
export class LiveLink extends EventEmitter {
  constructor({
    client,
    createSocket = (url, headers) => new WebSocket(url, { headers }),
    timings = {},
  }) {
    super();
    this.client = client;
    this.createSocket = createSocket;
    this.timings = { ...DEFAULT_SOCKET_TIMINGS, ...timings };
    this.socket = null;
    this.running = false;
    this.live = false;
    this.failures = 0;
    this.retryTimer = null;
    this.idleTimer = null;
    this.pingTimer = null;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.failures = 0;
    this.#open();
  }

  stop() {
    this.running = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.#drop();
  }

  #open() {
    if (!this.running) {
      return;
    }
    let socket;
    try {
      socket = this.createSocket(socketUrl(this.client.url), this.client.headers());
    } catch (err) {
      this.#scheduleRetry(err);
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }
      this.failures = 0;
      this.live = true;
      this.#armIdle();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        try {
          socket.send('ping');
        } catch {
          // the close event follows
        }
      }, this.timings.pingInterval);
      this.pingTimer.unref?.();
      this.emit('open');
    });
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.#armIdle();
      let frame;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return; // the echo of a ping
      }
      if (frame && typeof frame === 'object' && !Array.isArray(frame)) {
        this.emit('message', frame);
      }
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return;
      }
      this.#lost(new Error('socket closed'));
    });
    socket.addEventListener('error', () => {
      // A `close` follows: the retry is scheduled there.
    });
  }

  #armIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => this.#lost(new Error('no answer to the pings')),
      this.timings.idleTimeout,
    );
    this.idleTimer.unref?.();
  }

  #lost(err) {
    this.#drop();
    this.#scheduleRetry(err);
  }

  #drop() {
    const socket = this.socket;
    this.socket = null;
    clearTimeout(this.idleTimer);
    clearInterval(this.pingTimer);
    this.idleTimer = null;
    this.pingTimer = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
    if (this.live) {
      this.live = false;
      this.emit('close');
    }
  }

  #scheduleRetry(err) {
    if (!this.running) {
      return;
    }
    this.failures += 1;
    const delay = Math.min(
      this.timings.reconnectMax,
      this.timings.reconnectMin * 2 ** (this.failures - 1),
    );
    // The REST fallback reports an outage of the Recorder itself: debug here.
    logger.debug(`Live link down (${err?.message}), retry in ${Math.round(delay / 1000)} s`);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.#open(), delay);
    this.retryTimer.unref?.();
  }
}
