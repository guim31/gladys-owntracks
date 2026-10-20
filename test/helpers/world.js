// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory transport), the integration wired on it by registerHandlers, and
// a fake Recorder on a fake network, on a clock the test controls.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { createRecorder, network, settle, START } from './fakeRecorder.js';

export const FAST_SOCKET = {
  reconnectMin: 10,
  reconnectMax: 50,
  idleTimeout: 60_000,
  pingInterval: 60_000,
};

export const HOUSE = {
  id: 'house-1',
  name: 'Maison',
  selector: 'maison',
  latitude: 48.8566,
  longitude: 2.3522,
};

export const deviceId = (user, device) => `ext:test-integration:phone:${user}.${device}`;
export const featureId = (user, device, key) => `${deviceId(user, device)}:${key}`;
export const ALICE = ['alice', 'phone'];
export const BOB = ['bob', 'pixel'];

/**
 * @param {object} [options]
 * @param {object} [options.recorder] a fake Recorder (default: the fixtures)
 * @param {object} [options.config] integration config (default: the fake's address)
 * @param {'all' | 'none' | object[]} [options.devices] devices "created" in Gladys
 */
export async function createWorld({
  recorder = createRecorder(),
  config,
  devices = 'all',
  houses = [HOUSE],
  connect = true,
  timings,
  socketTimings,
  clock = { now: START },
} = {}) {
  const net = network(recorder);
  const gladys = createFakeGladys({
    config: config ?? { url: recorder.url },
    devices: Array.isArray(devices) ? devices : [],
    houses,
  });
  const app = registerHandlers(gladys, {
    fetch: net.fetch,
    createSocket: net.createSocket,
    // No throttling of the continuous values, unless a test asks for it.
    timings: { continuousGap: 0, ...timings },
    socketTimings: { ...FAST_SOCKET, ...socketTimings },
    now: () => clock.now,
  });
  if (connect) {
    await gladys.connect();
    await settle(20);
    if (devices === 'all') {
      // The user adds every discovered phone.
      for (const device of gladys.fake.discoveredDevices) {
        await gladys.fake.deviceCreated(structuredClone(device));
      }
      await settle();
    }
  }
  return { gladys, app, hub: app.hub, recorder, clock, net };
}
