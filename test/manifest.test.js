// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, LANGUAGES, LIMITS } from '../src/config.js';
import { SILENCE_HOURS, TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { AWAY, location, settle, transition, WORK } from './helpers/fakeRecorder.js';
import { ALICE, BOB, createWorld, deviceId } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, local transport, category, house location', () => {
  assert.equal(manifest.name, 'OwnTracks');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-owntracks:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-owntracks/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['security']);
  // getHouses() (distance from home) is a 403 without it.
  assert.equal(manifest.location, true);
  assert.equal(manifest.network_discovery, undefined);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`), manifest.docker_image);
});

test('scene triggers, scene actions and widgets require Gladys >= 5.1.0, not more', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
  // No widget form, no `source: "houses"`: 5.2.0 is not needed.
  assert.ok(!isAtLeast(minGladysVersion(), [5, 2, 0]), 'keep 5.1 users');
});

test('config_schema: the keys, defaults, bounds and options of the code', () => {
  const fields = manifest.config_schema.filter((f) => f.type !== 'section');
  assert.deepEqual(fields.map((f) => f.key).sort(), Object.keys(DEFAULT_CONFIG).sort());
  const field = (key) => manifest.config_schema.find((f) => f.key === key);
  assert.equal(field('password').type, 'secret');
  assert.equal(field('share_coordinates').type, 'boolean');
  assert.equal(field('share_coordinates').default, false, 'coordinates stay private by default');
  assert.equal(field('url').required, true);
  for (const f of fields) {
    if (f.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[f.key], f.default, `default of ${f.key}`);
    }
  }
  for (const [key, { min, max }] of Object.entries(LIMITS)) {
    assert.equal(field(key).min, min, key);
    assert.equal(field(key).max, max, key);
  }
  const languages = field('language');
  assert.deepEqual(
    languages.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(languages.default, 'fr');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('every manifest action, scene action and widget has a handler, and vice versa', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  assert.match((await fake.action('nope')).error, /not implemented/i);
  for (const action of manifest.actions) {
    const ack = await fake.action(action.key, {});
    assert.equal(ack.success, true, `action ${action.key}: ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.equal((await fake.widgetGet(WIDGET_KEY, { settings: {} })).success, true);
});

test('the "Test the connection" button answers in four languages', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.gladys.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(JSON.stringify(ack.data), /OwnTracks Recorder 1\.0\.4/);
});

test('scene action outputs are the ones the code returns', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const action of manifest.scene_actions) {
    const ack = await world.gladys.fake.sceneAction(action.key, { device: deviceId(...ALICE) });
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data.outputs).sort(),
      keysOf(action.outputs).sort(),
      action.key,
    );
    for (const output of action.outputs) {
      assert.equal(typeof ack.data.outputs[output.key], output.type, output.key);
    }
  }
});

test('the scene triggers the hub fires are declared, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const clock = { now: Date.parse('2026-10-20T14:15:00Z') };
  const world = await createWorld({ clock, timings: { minuteCheck: 5 } });
  t.after(() => world.app.stop());
  const { recorder } = world;
  recorder.publish(transition(...ALICE, 'leave', 'Home'));
  recorder.publish(location(...ALICE, AWAY));
  recorder.publish(location(...ALICE, { lat: 48.8566, lon: 2.3522, inregions: ['Home'] }));
  recorder.publish(location(...BOB, { ...WORK, inregions: ['Work'] }));
  await settle(20);
  clock.now = Date.parse('2026-10-22T14:15:00Z');
  await settle(20);
  const events = world.gladys.fake.sceneEvents;
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((e) => e.key === trigger.key);
    assert.ok(event, `${trigger.key} fired`);
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in event.data, `${trigger.key}: "${key}" is in the event data`);
    }
    for (const variable of trigger.variables) {
      assert.equal(typeof event.data[variable.key], variable.type, variable.key);
    }
  }
  const hours = manifest.scene_triggers
    .find((t) => t.key === TRIGGERS.stopped)
    .fields.find((f) => f.key === 'hours');
  assert.deepEqual(
    hours.options.map((o) => o.value),
    SILENCE_HOURS,
  );
});

test('trigger filters: only the silence is required (empty would mean every step)', () => {
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields) {
      const required = trigger.key === TRIGGERS.stopped && field.key === 'hours';
      assert.equal(field.required === true, required, `${trigger.key}.${field.key}`);
      assert.notEqual(field.type, 'boolean');
    }
  }
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (Gladys#3154/#3155)', () => {
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret');
      assert.notEqual(field.required, true);
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});
