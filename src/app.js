// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys
// in the tests) and returns the hub, so index.js stays a few lines and the
// tests drive the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { Hub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'owntracks-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: fetch, createSocket, timings, socketTimings, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new Hub({
    gladys,
    fetch: options.fetch,
    createSocket: options.createSocket,
    timings: options.timings,
    socketTimings: options.socketTimings,
    now: options.now,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // request arriving during the start is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): re-sync what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await hub.reportInitFailed();
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.scan()));
  // The devices are published with should_poll: false (pushed by the Recorder);
  // this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady((device) => hub.poll(device)));
  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onConfigUpdated(
    whenReady((config) => {
      logger.info('Configuration updated');
      return hub.reconfigure(normalizeConfig(config));
    }),
  );

  gladys.onAction(
    'test_connection',
    whenReady(() => hub.testReport()),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
