// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake Recorder: devices, states,
// home and region triggers, silences, presence pings, REST fallback, Basic
// auth, connection status and quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AWAY,
  createRecorder,
  HOUSE_POINT,
  location,
  network,
  PASSWORD,
  settle,
  START,
  transition,
  USER,
  WORK,
} from './helpers/fakeRecorder.js';
import { ALICE, BOB, createWorld, deviceId, featureId } from './helpers/world.js';

process.env.TZ = 'UTC';

/** Captures the SDK logger's lines (console.log for debug/info, console.error above). */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.mock.method(console, 'warn', record);
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  });
  return {
    lines,
    take() {
      return lines.splice(0);
    },
  };
}

const last = (gladys, [user, device], key) => gladys.fake.lastState(featureId(user, device, key));
const events = (gladys) => gladys.fake.sceneEvents.map((e) => [e.key, e.data.region ?? null]);

test('publishes one device per phone and the states of the added ones', async (t) => {
  const { gladys, app } = await createWorld();
  t.after(() => app.stop());
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(devices.map((d) => d.external_id).sort(), [
    deviceId(...ALICE),
    deviceId(...BOB),
  ]);
  // The card of alice names her phone; bob has none.
  assert.deepEqual(devices.map((d) => d.name).sort(), ['Alice (phone)', 'bob (pixel)']);
  assert.equal(last(gladys, ALICE, 'at_home'), 1);
  assert.equal(last(gladys, ALICE, 'distance_home'), 0);
  assert.equal(last(gladys, ALICE, 'region'), 'Home');
  assert.equal(last(gladys, ALICE, 'battery'), 86);
  assert.equal(last(gladys, ALICE, 'last_position'), '20/10 14:08');
  assert.equal(last(gladys, BOB, 'at_home'), 0);
  assert.equal(last(gladys, BOB, 'distance_home'), 1);
  assert.equal(last(gladys, BOB, 'region'), 'Hors région');
  assert.equal(last(gladys, ALICE, 'presence'), 1);
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
  // Nothing fired for what was already there at start.
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('no state for a phone the user did not add, and its states once added', async (t) => {
  const { gladys, app } = await createWorld({ devices: 'none' });
  t.after(() => app.stop());
  assert.equal(gladys.fake.states.length, 0);
  const bob = gladys.fake.discoveredDevices.find((d) => d.external_id === deviceId(...BOB));
  await gladys.fake.deviceCreated(structuredClone(bob));
  await settle();
  assert.equal(last(gladys, BOB, 'region'), 'Hors région');
  assert.equal(last(gladys, ALICE, 'region'), undefined);
  assert.ok(gladys.fake.widgetRefreshes.includes('phones'));
});

test('leaving and coming home fire departure and arrival, with the regions', async (t) => {
  const { gladys, app, recorder } = await createWorld();
  t.after(() => app.stop());
  recorder.publish(transition(...ALICE, 'leave', 'Home'));
  recorder.publish(location(...ALICE, WORK));
  await settle(20);
  assert.deepEqual(events(gladys), [
    ['region_exit', 'Home'],
    ['home_departure', null],
  ]);
  assert.equal(last(gladys, ALICE, 'at_home'), 0);
  assert.equal(last(gladys, ALICE, 'region'), 'Hors région');
  assert.equal(last(gladys, ALICE, 'distance_home'), 4.1);
  const exit = gladys.fake.sceneEvents[0].data;
  assert.equal(exit.device, deviceId(...ALICE));
  assert.equal(exit.phone, 'Alice (phone)');
  // Coordinates are not shared by default.
  assert.equal(exit.map_url, '');

  recorder.publish(location(...ALICE, { ...HOUSE_POINT, inregions: ['Home'] }));
  await settle(20);
  assert.deepEqual(events(gladys).slice(2), [
    ['region_enter', 'Home'],
    ['home_arrival', null],
  ]);
  assert.match(gladys.fake.sceneEvents[3].data.time, /^\d\d:\d\d$/);
});

test('a transition and the location after it fire once', async (t) => {
  const { gladys, app, recorder } = await createWorld();
  t.after(() => app.stop());
  recorder.publish(transition(...BOB, 'enter', 'Work'));
  recorder.publish(location(...BOB, { ...WORK, inregions: ['Work'] }));
  // The same location again (snapshot after a reconnection): nothing.
  recorder.push(recorder.last.find((l) => l.username === 'bob'));
  await settle(20);
  assert.deepEqual(events(gladys), [['region_enter', 'Work']]);
  assert.equal(last(gladys, BOB, 'region'), 'Work');
});

test('an app that never sends inregions keeps the regions of its transitions', async (t) => {
  const { gladys, app, recorder } = await createWorld();
  t.after(() => app.stop());
  // bob's app has not sent `inregions` so far.
  recorder.publish(transition(...BOB, 'enter', 'Gym'));
  recorder.publish(location(...BOB, AWAY));
  await settle(20);
  assert.equal(last(gladys, BOB, 'region'), 'Gym');
  recorder.publish(transition(...BOB, 'leave', 'Gym'));
  await settle(20);
  assert.deepEqual(events(gladys), [
    ['region_enter', 'Gym'],
    ['region_exit', 'Gym'],
  ]);
});

test('an app that sends inregions is out of every region when it leaves it out', async (t) => {
  const { gladys, app, recorder } = await createWorld();
  t.after(() => app.stop());
  recorder.publish(location(...ALICE, { ...HOUSE_POINT, inregions: ['Home', 'Garden'] }));
  recorder.publish(location(...ALICE, AWAY));
  await settle(20);
  assert.deepEqual(events(gladys), [
    ['region_enter', 'Garden'],
    ['region_exit', 'Home'],
    ['region_exit', 'Garden'],
    ['home_departure', null],
  ]);
});

test('share_coordinates adds the map link to the events', async (t) => {
  const recorder = createRecorder();
  const { gladys, app } = await createWorld({
    recorder,
    config: { url: recorder.url, share_coordinates: true },
  });
  t.after(() => app.stop());
  recorder.publish(location(...BOB, { ...WORK, inregions: ['Work'] }));
  await settle(20);
  const enter = gladys.fake.sceneEvents.find((e) => e.key === 'region_enter');
  assert.equal(
    enter.data.map_url,
    'https://www.openstreetmap.org/?mlat=48.87000&mlon=2.30000#map=16/48.87000/2.30000',
  );
});

test('a home region replaces the radius around the Gladys house', async (t) => {
  const recorder = createRecorder();
  const { gladys, app } = await createWorld({
    recorder,
    houses: [],
    config: { url: recorder.url, home_region: 'home' },
  });
  t.after(() => app.stop());
  const alice = gladys.fake.discoveredDevices.find((d) => d.external_id === deviceId(...ALICE));
  const keys = alice.features.map((f) => f.external_id.split(':').pop());
  assert.ok(!keys.includes('distance_home'));
  assert.ok(keys.includes('presence'));
  // Case-insensitive match on the region name "Home".
  assert.equal(last(gladys, ALICE, 'at_home'), 1);
  assert.equal(last(gladys, BOB, 'at_home'), 0);
  // The region says home even 400 m from the house.
  recorder.publish(location(...BOB, { ...AWAY, inregions: ['Home'] }));
  await settle(20);
  assert.equal(last(gladys, BOB, 'at_home'), 1);
  assert.ok(gladys.fake.sceneEvents.some((e) => e.key === 'home_arrival'));
});

test('without a house nor a home region, no home features', async (t) => {
  const { gladys, app } = await createWorld({ houses: [] });
  t.after(() => app.stop());
  for (const device of gladys.fake.discoveredDevices) {
    const keys = device.features.map((f) => f.external_id.split(':').pop());
    assert.deepEqual(keys, ['battery', 'last_position', 'region']);
  }
});

test('the house is picked by name, else the first located one', async (t) => {
  const houses = [
    { id: 'a', name: 'Appartement', selector: 'a', latitude: null, longitude: null },
    { id: 'b', name: 'Chalet', selector: 'b', latitude: 45.9, longitude: 6.87 },
    { id: 'c', name: 'Maison', selector: 'c', latitude: 48.8566, longitude: 2.3522 },
  ];
  const first = await createWorld({ houses });
  t.after(() => first.app.stop());
  assert.equal(first.hub.house.name, 'Chalet');
  const recorder = createRecorder();
  const named = await createWorld({
    recorder,
    houses,
    config: { url: recorder.url, house: 'maison' },
  });
  t.after(() => named.app.stop());
  assert.equal(named.hub.house.name, 'Maison');
});

test('"No position received" fires once per threshold, and a new position resets it', async (t) => {
  const clock = { now: START };
  const { gladys, app, recorder } = await createWorld({ clock, timings: { minuteCheck: 5 } });
  t.after(() => app.stop());
  const stopped = () =>
    gladys.fake.sceneEvents
      .filter((e) => e.key === 'tracking_stopped')
      .map((e) => [e.data.device === deviceId(...BOB) ? 'bob' : 'alice', e.data.hours]);
  // bob's last location is at 14:10:01, alice's at 14:08.
  clock.now = Date.parse('2026-10-20T15:09:00Z');
  await settle(20);
  assert.deepEqual(stopped(), [['alice', '1']]);
  clock.now = Date.parse('2026-10-20T17:20:00Z');
  await settle(20);
  assert.deepEqual(stopped(), [
    ['alice', '1'],
    ['bob', '1'],
    ['bob', '2'],
    ['bob', '3'],
    ['alice', '2'],
    ['alice', '3'],
  ]);
  const event = gladys.fake.sceneEvents.find((e) => e.key === 'tracking_stopped').data;
  assert.equal(event.last_position, '14:08');
  const seen = stopped().length;
  recorder.publish(location(...BOB, { ...AWAY, tst: Math.floor(clock.now / 1000) }));
  await settle(20);
  clock.now += 3_600_000;
  await settle(20);
  assert.deepEqual(stopped().slice(seen), [['bob', '1']]);
});

test('a silence that began before the start is not announced', async (t) => {
  const clock = { now: Date.parse('2026-10-21T14:15:00Z') };
  const { gladys, app } = await createWorld({ clock, timings: { minuteCheck: 5 } });
  t.after(() => app.stop());
  await settle(20);
  assert.deepEqual(gladys.fake.sceneEvents, []);
  clock.now = Date.parse('2026-10-22T14:15:00Z');
  await settle(20);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => e.data.hours),
    ['48', '48'],
  );
});

test('presence pings repeat while the last position at home is recent, then stop', async (t) => {
  const clock = { now: START };
  const { gladys, app, recorder, hub } = await createWorld({
    clock,
    timings: { minuteCheck: 10 },
  });
  t.after(() => app.stop());
  const pings = () =>
    gladys.fake.states.filter(
      (s) => s.device_feature_external_id === featureId(...ALICE, 'presence'),
    ).length;
  recorder.publish(
    location(...ALICE, { ...HOUSE_POINT, inregions: ['Home'], tst: Math.floor(START / 1000) }),
  );
  await settle(20);
  const first = pings();
  clock.now += 4 * 60_000;
  await settle(30);
  assert.equal(pings(), first, 'not before 5 minutes');
  clock.now += 2 * 60_000;
  await settle(30);
  assert.equal(pings(), first + 1);
  // 121 minutes after the last position (presence_max_age 120): no more pings.
  clock.now = START + 121 * 60_000;
  await settle(30);
  const stopped = pings();
  clock.now += 10 * 60_000;
  await settle(30);
  assert.equal(pings(), stopped);
  assert.equal(hub.view(hub.phones.get('alice/phone')).atHome, true);
});

test('while the socket is down, the REST API is read, and a missed crossing still fires', async (t) => {
  const recorder = createRecorder();
  const { gladys, app, net } = await createWorld({
    recorder,
    timings: { fallbackInterval: 20 },
  });
  t.after(() => app.stop());
  let socketsAllowed = true;
  app.hub.link.createSocket = (url, headers) => {
    if (!socketsAllowed) {
      throw new Error('refused');
    }
    return net.createSocket(url, headers);
  };
  socketsAllowed = false;
  recorder.dropSockets();
  await settle(10);
  // A location nobody pushes: only the REST fallback can see it.
  recorder.last = [
    ...recorder.last.filter((l) => l.username !== 'bob'),
    location(...BOB, { ...WORK, inregions: ['Work'] }),
  ];
  await settle(60);
  assert.equal(last(gladys, BOB, 'region'), 'Work');
  assert.deepEqual(events(gladys), [['region_enter', 'Work']]);
  socketsAllowed = true;
  await settle(80);
  assert.equal(app.hub.link.live, true, 'the socket came back');
});

test('a silent socket is replaced: pings that get no echo', async (t) => {
  const recorder = createRecorder();
  const { app } = await createWorld({
    recorder,
    socketTimings: { pingInterval: 5, idleTimeout: 30 },
  });
  t.after(() => app.stop());
  const [socket] = recorder.sockets;
  await settle(20);
  assert.ok(socket.sent.includes('ping'));
  assert.ok(recorder.sockets.has(socket), 'the echoes keep it alive');
  recorder.mute = true;
  await settle(80);
  assert.ok(!recorder.sockets.has(socket), 'a mute socket is closed');
  recorder.mute = false;
  await settle(80);
  assert.equal(app.hub.link.live, true);
});

test('Basic auth of a reverse proxy, on the API and on the WebSocket', async (t) => {
  const recorder = createRecorder({ basicAuth: true });
  const { gladys, app } = await createWorld({
    recorder,
    config: { url: recorder.url, username: USER, password: PASSWORD },
  });
  t.after(() => app.stop());
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(recorder.sockets.size, 1);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('refused credentials are reported once, in four languages, without the password', async (t) => {
  const logs = captureLogs(t);
  const recorder = createRecorder({ basicAuth: true });
  const { gladys, app } = await createWorld({
    recorder,
    config: { url: recorder.url, username: USER, password: 'wrong-password-value' },
    timings: { fallbackInterval: 5, unauthorizedRetry: 60_000 },
  });
  t.after(() => app.stop());
  const reads = () => recorder.requests.filter((r) => r.path === '/api/0/last').length;
  const count = reads();
  await settle(60);
  const status = gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.deepEqual(Object.keys(status.message).sort(), ['de', 'en', 'es', 'fr']);
  assert.match(status.message.fr, /refusé/);
  const warnings = logs.lines.filter((line) => /WARN/.test(line));
  assert.equal(warnings.length, 1, logs.lines.join('\n'));
  assert.ok(logs.lines.every((line) => !line.includes('wrong-password-value')));
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  assert.equal(reads(), count, 'not retried every minute');
});

test('an empty configuration says what to fill in, and asks nothing of the network', async (t) => {
  const recorder = createRecorder();
  const { gladys, app } = await createWorld({ recorder, config: {} });
  t.after(() => app.stop());
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /address of your OwnTracks Recorder/);
  assert.equal(recorder.requests.length, 0);
  const bad = await createWorld({ recorder, config: { url: 'ftp://nope' } });
  t.after(() => bad.app.stop());
  assert.match(bad.gladys.fake.connectionStatus.message.en, /not valid/);
});

test('continuous values of a moving phone are sent at most every period', async (t) => {
  const clock = { now: START };
  const { gladys, app, recorder } = await createWorld({
    clock,
    timings: { continuousGap: 30_000 },
  });
  t.after(() => app.stop());
  const batteries = () =>
    gladys.fake.states.filter((s) => s.device_feature_external_id === featureId(...BOB, 'battery'));
  const before = batteries().length;
  for (let i = 1; i <= 5; i += 1) {
    clock.now += 5_000;
    recorder.publish(location(...BOB, { ...AWAY, batt: 60 - i }));
    await settle(10);
  }
  assert.ok(batteries().length - before <= 1, `${batteries().length - before} battery states`);
  // The region goes at once.
  recorder.publish(location(...BOB, { ...WORK, inregions: ['Work'] }));
  await settle(10);
  assert.equal(last(gladys, BOB, 'region'), 'Work');
});

test('two quick configuration changes leave one live link', async (t) => {
  const { gladys, app, recorder } = await createWorld();
  t.after(() => app.stop());
  await Promise.all([
    gladys.fake.configUpdated({ url: recorder.url, language: 'en' }),
    gladys.fake.configUpdated({ url: recorder.url, language: 'de' }),
  ]);
  await settle(40);
  assert.equal(recorder.sockets.size, 1);
  assert.equal(app.hub.config.language, 'de');
});

test('a new configuration reconnects with it', async (t) => {
  const first = createRecorder();
  const second = createRecorder({ host: '192.0.2.11' });
  const net = network(first, second);
  const { gladys, app } = await createWorld({ recorder: first });
  t.after(() => app.stop());
  app.hub.fetch = net.fetch;
  app.hub.createSocket = net.createSocket;
  second.last = second.last.filter((l) => l.username === 'bob');
  await gladys.fake.configUpdated({ url: second.url });
  await settle(20);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [deviceId(...BOB)],
  );
  assert.ok(second.requests.length > 0);
});

test('a normal cycle writes nothing at info level; an outage one line, its end one', async (t) => {
  const logs = captureLogs(t);
  const recorder = createRecorder();
  const { app } = await createWorld({ recorder, timings: { fallbackInterval: 15 } });
  t.after(() => app.stop());
  const start = logs.take();
  assert.ok(start.some((line) => /\[INFO\].*Connected to OwnTracks Recorder 1\.0\.4/.test(line)));
  for (let i = 0; i < 5; i += 1) {
    recorder.publish(location(...BOB, { ...AWAY, batt: 50 - i }));
  }
  recorder.publish(location(...BOB, { ...WORK, inregions: ['Work'] }));
  recorder.publish(transition(...BOB, 'leave', 'Work'));
  await settle(30);
  assert.deepEqual(logs.take(), []);

  recorder.up = false;
  recorder.dropSockets();
  await settle(80);
  const outage = logs.take();
  assert.equal(outage.length, 1, outage.join('\n'));
  assert.match(outage[0], /WARN.*unreachable/);
  recorder.up = true;
  await settle(80);
  const back = logs.take();
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /INFO.*The Recorder is back/);
});

test('never a coordinate nor a region name in the logs, even in debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  const { app, recorder } = await createWorld();
  t.after(() => app.stop());
  recorder.publish(location(...ALICE, { ...WORK, inregions: ['Secret place'] }));
  recorder.publish(transition(...ALICE, 'leave', 'Secret place'));
  await settle(30);
  assert.ok(logs.lines.length > 0);
  assert.ok(
    logs.lines.every((line) => !/48\.8|2\.3[0-9]|Secret place/.test(line)),
    logs.lines.join('\n'),
  );
});

test('a heartbeat re-sends unchanged values', async (t) => {
  const { gladys, app } = await createWorld({ timings: { heartbeatCheck: 20, heartbeat: 1 } });
  t.after(() => app.stop());
  const count = () =>
    gladys.fake.states.filter((s) => s.device_feature_external_id === featureId(...BOB, 'region'))
      .length;
  const before = count();
  await settle(50);
  assert.ok(count() > before);
});

test('onPoll re-sends the states of a device', async (t) => {
  const { gladys, app } = await createWorld();
  t.after(() => app.stop());
  gladys.forgetPublishedStates();
  const device = gladys.fake.discoveredDevices[0];
  assert.deepEqual(await gladys.fake.poll(device), { success: true });
  assert.ok(gladys.fake.states.length > 0);
});

test('a new phone in the Recorder shows up in the discovered devices', async (t) => {
  const { gladys, app, recorder } = await createWorld();
  t.after(() => app.stop());
  recorder.publish(location('carol', 'iphone.13', AWAY));
  await settle(20);
  assert.ok(
    gladys.fake.discoveredDevices.some(
      (d) => d.external_id === 'ext:test-integration:phone:carol.iphone%2E13',
    ),
  );
});

test('a location without coordinates, or of no user, is ignored', async (t) => {
  const { gladys, app, recorder } = await createWorld();
  t.after(() => app.stop());
  recorder.push({ _type: 'location', username: 'bob', device: 'pixel', tst: 1792600000 });
  recorder.push({ _type: 'location', lat: 1, lon: 2, tst: 1792600000 });
  recorder.push({ _type: 'lwt', topic: 'owntracks/bob/pixel', tst: 1792600000 });
  await settle(20);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.equal(last(gladys, BOB, 'region'), 'Hors région');
  assert.deepEqual(gladys.fake.sceneEvents, []);
});
