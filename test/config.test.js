import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig, normalizeUrl } from '../src/config.js';

test('the Recorder address: default port 8083, prefix kept, pages and credentials refused', () => {
  assert.equal(normalizeUrl('192.0.2.10'), 'http://192.0.2.10:8083');
  assert.equal(normalizeUrl(' 192.0.2.10:9000 '), 'http://192.0.2.10:9000');
  assert.equal(normalizeUrl('recorder.example.com'), 'http://recorder.example.com:8083');
  assert.equal(normalizeUrl('https://example.com/owntracks/'), 'https://example.com/owntracks');
  assert.equal(normalizeUrl('http://192.0.2.10:8083/last/'), 'http://192.0.2.10:8083');
  assert.equal(normalizeUrl('http://192.0.2.10:8083/api/0/last'), 'http://192.0.2.10:8083');
  assert.equal(normalizeUrl('https://example.com/ot/map/index.html'), 'https://example.com/ot');
  assert.equal(normalizeUrl('http://user:secret@192.0.2.10'), null);
  assert.equal(normalizeUrl('ftp://192.0.2.10'), null);
  assert.equal(normalizeUrl(''), null);
  assert.equal(normalizeUrl(undefined), null);
});

test('normalization: defaults, bounds, booleans, languages', () => {
  const config = normalizeConfig({});
  assert.equal(config.url, null);
  assert.equal(config.invalidUrl, false);
  assert.equal(config.homeRadius, DEFAULT_CONFIG.home_radius);
  assert.equal(config.presenceMaxAge, 120);
  assert.equal(config.shareCoordinates, false);
  assert.equal(config.language, 'fr');
  assert.equal(isConfigured(config), false);

  const set = normalizeConfig({
    url: '192.0.2.10',
    username: ' proxy ',
    password: ' spaced ',
    home_radius: '10',
    home_region: ' Home ',
    presence_max_age: 5000,
    share_coordinates: true,
    language: 'de',
  });
  assert.equal(set.url, 'http://192.0.2.10:8083');
  assert.equal(set.username, 'proxy');
  assert.equal(set.password, ' spaced ');
  assert.equal(set.homeRadius, 20);
  assert.equal(set.homeRegion, 'Home');
  assert.equal(set.presenceMaxAge, 1440);
  assert.equal(set.shareCoordinates, true);
  assert.equal(set.language, 'de');
  assert.equal(isConfigured(set), true);
  assert.equal(normalizeConfig({ url: 'ftp://x' }).invalidUrl, true);
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});
