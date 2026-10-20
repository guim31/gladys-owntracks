// -----------------------------------------------------------------------------
// The scene action `get_position` and the widget `phones`, through the SDK's
// fake Gladys (its validators refuse what the core refuses).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildContent, MAX_ITEMS } from '../src/widgets.js';
import { AWAY, createRecorder, location, settle } from './helpers/fakeRecorder.js';
import { ALICE, BOB, createWorld, deviceId } from './helpers/world.js';

process.env.TZ = 'UTC';

test('get_position: a sentence and the values, in the configured language', async (t) => {
  const { gladys, app } = await createWorld();
  t.after(() => app.stop());
  const home = await gladys.fake.sceneAction('get_position', { device: deviceId(...ALICE) });
  assert.equal(home.success, true);
  assert.deepEqual(home.data.outputs, {
    sentence: 'Alice (phone) est à la maison, position de 14:08.',
    phone: 'Alice (phone)',
    status: 'À la maison',
    at_home: true,
    region: 'Home',
    distance_km: 0,
    battery: 86,
    last_position: '14:08',
    map_url: '',
  });
  const away = await gladys.fake.sceneAction('get_position', { device: deviceId(...BOB) });
  assert.equal(
    away.data.outputs.sentence,
    "bob (pixel) n'est pas à la maison, à 980 m de la maison, position de 14:10.",
  );
  const unknown = await gladys.fake.sceneAction('get_position', { device: 'ext:other:x' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /inconnu/);
});

test('get_position gives the map link only when coordinates are shared', async (t) => {
  const recorder = createRecorder();
  const { gladys, app } = await createWorld({
    recorder,
    config: { url: recorder.url, share_coordinates: true, language: 'en' },
  });
  t.after(() => app.stop());
  const ack = await gladys.fake.sceneAction('get_position', { device: deviceId(...ALICE) });
  assert.match(ack.data.outputs.map_url, /^https:\/\/www\.openstreetmap\.org\/\?mlat=48\.85660/);
  assert.equal(ack.data.outputs.sentence, 'Alice (phone) is at home, position of 14:08.');
});

test('the widget lists every phone with its presence, valid for the core', async (t) => {
  const { gladys, app } = await createWorld();
  t.after(() => app.stop());
  const ack = await gladys.fake.widgetGet('phones', { settings: {}, language: 'fr' });
  assert.equal(ack.success, true);
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  const [list] = content.components;
  assert.deepEqual(
    list.items.map((item) => [item.title, item.subtitle, item.badge.text]),
    [
      ['Alice (phone)', 'Home · 14:08', 'À la maison'],
      ['bob (pixel)', 'Hors région · 14:10', 'Absent'],
    ],
  );
  assert.match(list.items[0].description, /Batterie : 86 %/);
  assert.equal(list.items[0].links, undefined, 'no map without shared coordinates');
});

test('the widget says when there is nothing, and caps the list', async (t) => {
  const recorder = createRecorder({ last: [] });
  const empty = await createWorld({ recorder });
  t.after(() => empty.app.stop());
  const nothing = buildContent(empty.hub, { language: 'de' });
  assert.match(nothing.components[0].text, /Noch kein Telefon/);

  const {
    hub,
    app,
    recorder: full,
  } = await createWorld({
    recorder: createRecorder(),
    config: undefined,
  });
  t.after(() => app.stop());
  for (let i = 0; i < 10; i += 1) {
    full.publish(location(`user${i}`, 'phone', AWAY));
  }
  await settle(30);
  const content = buildContent(hub, { language: 'en' });
  assert.equal(content.components[0].items.length, MAX_ITEMS);
  assert.equal(content.components[1].text, '4 more phone(s) not shown.');
  assert.deepEqual(validateWidgetContent(content), []);
});
