// -----------------------------------------------------------------------------
// The HTTP client and the model, on the answers of a real Recorder 1.0.4.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basicAuth, RecorderClient, RecorderError } from '../src/owntracks/client.js';
import { locationOf, ownerOf, regionsOf, viewOf } from '../src/model.js';
import { socketUrl } from '../src/owntracks/socket.js';
import { createRecorder, fixture, network, PASSWORD, USER } from './helpers/fakeRecorder.js';

test('reads the version, the users and the latest locations, asking only for the needed fields', async () => {
  const recorder = createRecorder();
  const client = new RecorderClient({ url: recorder.url, fetch: network(recorder).fetch });
  assert.equal((await client.getVersion()).version, '1.0.4');
  assert.deepEqual(await client.getUsers(), ['bob', 'alice']);
  const last = await client.getLast();
  assert.equal(last.length, 2);
  const url = new URL(recorder.requests.at(-1).url);
  assert.equal(url.pathname, '/api/0/last');
  assert.ok(!url.searchParams.get('fields').includes('face'), 'never the picture of the card');
});

test('errors carry a stable code and never the password', async () => {
  const recorder = createRecorder({ basicAuth: true });
  const fetch = network(recorder).fetch;
  const refused = new RecorderClient({
    url: recorder.url,
    username: USER,
    password: 'nope',
    fetch,
  });
  await assert.rejects(refused.getLast(), (err) => {
    assert.ok(err instanceof RecorderError);
    assert.equal(err.code, 'unauthorized');
    assert.ok(!err.message.includes('nope'));
    return true;
  });
  const ok = new RecorderClient({ url: recorder.url, username: USER, password: PASSWORD, fetch });
  assert.equal((await ok.getLast()).length, 2);
  recorder.up = false;
  await assert.rejects(ok.getLast(), { code: 'unreachable' });
  const elsewhere = new RecorderClient({ url: 'http://198.51.100.1:8083', fetch });
  await assert.rejects(elsewhere.getVersion(), { code: 'unreachable' });
  assert.equal(basicAuth('', 'x'), null);
  assert.equal(basicAuth('u', 'p'), `Basic ${Buffer.from('u:p').toString('base64')}`);
});

test('a non-JSON or non-list answer is an invalid answer', async () => {
  const fetch = async (url) =>
    url.includes('version') ? new Response('<html>') : Response.json({ not: 'a list' });
  const client = new RecorderClient({ url: 'http://192.0.2.10:8083', fetch });
  await assert.rejects(client.getVersion(), { code: 'invalid' });
  await assert.rejects(client.getLast(), { code: 'invalid' });
});

test('the WebSocket address follows the scheme and the prefix', () => {
  assert.equal(socketUrl('http://192.0.2.10:8083'), 'ws://192.0.2.10:8083/ws/last');
  assert.equal(socketUrl('https://example.com/ot'), 'wss://example.com/ot/ws/last');
});

test('the model reads the real messages of the Recorder', () => {
  const [bob, alice] = fixture('last.json');
  assert.deepEqual(ownerOf(alice), { user: 'alice', device: 'phone' });
  assert.deepEqual(ownerOf({ topic: 'owntracks/carol/ipad' }), { user: 'carol', device: 'ipad' });
  assert.equal(ownerOf({ topic: 'nope' }), null);
  assert.deepEqual(locationOf(alice), {
    latitude: 48.8566,
    longitude: 2.3522,
    accuracy: 12,
    battery: 86,
    time: 1792505280000,
  });
  assert.equal(locationOf({ lat: 91, lon: 2, tst: 1 }), null);
  assert.deepEqual(regionsOf(alice), ['Home']);
  assert.equal(regionsOf(bob), null);
  assert.deepEqual(regionsOf({ inregions: [' Home ', 'Home', '', 3] }), ['Home']);

  const [transition] = fixture('ws-frames.json');
  assert.equal(transition._type, 'transition');
  assert.deepEqual(ownerOf(transition), { user: 'bob', device: 'pixel' });

  const house = { latitude: 48.8566, longitude: 2.3522 };
  const config = { homeRegion: '', homeRadius: 150 };
  const phone = {
    user: 'bob',
    device: 'pixel',
    card: null,
    location: locationOf(bob),
    regions: [],
  };
  const view = viewOf(phone, { house, config });
  assert.equal(view.name, 'bob (pixel)');
  assert.equal(Math.round(view.distanceKm * 100) / 100, 0.98);
  assert.equal(view.atHome, false);
  assert.equal(view.status, 'away');
  assert.equal(viewOf({ ...phone, location: null }, { house, config }).status, 'unknown');
});
