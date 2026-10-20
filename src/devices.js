// -----------------------------------------------------------------------------
// OwnTracks phone -> Gladys device, and phone view -> feature states.
//
// One Gladys device per user/device pair of the Recorder, keyed on that pair
// (the topic `owntracks/<user>/<device>`, which the app keeps for its whole
// life). Both parts are percent-encoded, dots included, then joined by a dot:
// two pairs can never give the same id.
//
// Couples chosen among those the Gladys front knows (test/gladys-rules.test.js):
// - at home: presence-sensor/binary, a state scenes can test and trigger on;
// - presence: presence-sensor/push, the couple the core's "Check user
//   presence" scene action reads (a value received in the last N minutes means
//   "seen at home"), like the Bluetooth presence of the core;
// - distance from home: distance-sensor/decimal in km;
// - battery: battery/integer; last position, region: text/text.
// Distance needs a located Gladys house, at home and presence a home rule.
// No coordinates in any feature: they stay in the container.
//
// Feature keys are forever: never renamed.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { formatTime, NAMES, REGION_TEXT } from './texts.js';

export const DEVICE_TYPE = 'phone';

export const MAX_DISTANCE_KM = 20_040; // half the Earth's circumference

const part = (text) => encodeURIComponent(text).replace(/\./g, '%2E');

export function deviceIds(gladys, user, device) {
  return gladys.externalIds(DEVICE_TYPE, `${part(user)}.${part(device)}`);
}

/** The feature key of a feature external id (`...:phone:a.b:region` -> `region`). */
export function featureKeyOf(externalId) {
  return externalId.slice(externalId.lastIndexOf(':') + 1);
}

/**
 * @param {object} gladys
 * @param {object} view the phone view (model.viewOf)
 * @param {{ language: string, hasHouse: boolean, hasHome: boolean }} options
 */
export function buildDevice(gladys, view, { language, hasHouse, hasHome }) {
  const names = NAMES[language] ?? NAMES.en;
  const ids = deviceIds(gladys, view.user, view.device);
  const feature = (key, fields) => ({
    name: names[key],
    external_id: ids.feature(key),
    selector: ids.feature(key),
    read_only: true,
    has_feedback: false,
    ...fields,
  });
  const text = { category: CAT.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 };

  const features = [];
  if (hasHome) {
    features.push(
      feature('at_home', {
        category: CAT.PRESENCE_SENSOR,
        type: TYPE.SENSOR.BINARY,
        min: 0,
        max: 1,
      }),
      feature('presence', {
        category: CAT.PRESENCE_SENSOR,
        type: TYPE.SENSOR.PUSH,
        min: 0,
        max: 1,
      }),
    );
  }
  if (hasHouse) {
    features.push(
      feature('distance_home', {
        category: CAT.DISTANCE_SENSOR,
        type: TYPE.SENSOR.DECIMAL,
        unit: UNIT.KM,
        min: 0,
        max: MAX_DISTANCE_KM,
      }),
    );
  }
  features.push(
    feature('battery', {
      category: CAT.BATTERY,
      type: TYPE.BATTERY.INTEGER,
      unit: UNIT.PERCENT,
      min: 0,
      max: 100,
    }),
    feature('last_position', text),
    feature('region', text),
  );

  return {
    name: view.name,
    external_id: ids.device,
    selector: ids.device,
    model: 'OwnTracks',
    // Pushed by the Recorder's WebSocket (and a REST fallback): never polled.
    should_poll: false,
    features,
  };
}

/** The region text of a view. */
export function regionText(view, language) {
  const texts = REGION_TEXT[language] ?? REGION_TEXT.en;
  if (!view.hasPosition) {
    return texts.no_position;
  }
  return view.regions.length > 0 ? view.regions.join(', ').slice(0, 250) : texts.none;
}

/**
 * The states of a view, for the features the device has (`keys`). The
 * presence push is not here: it is a "seen" ping, sent by the hub.
 * @returns {{ device_feature_external_id: string, state?: number, text?: string }[]}
 */
export function buildStates(gladys, view, { language, keys }) {
  const ids = deviceIds(gladys, view.user, view.device);
  const states = [];
  const add = (key, value) => {
    if (!keys.has(key) || value === null || value === undefined) {
      return;
    }
    if (typeof value === 'string') {
      if (value !== '') {
        states.push({ device_feature_external_id: ids.feature(key), text: value });
      }
      return;
    }
    states.push({ device_feature_external_id: ids.feature(key), state: value });
  };

  add('region', regionText(view, language));
  if (view.hasPosition) {
    add('last_position', formatTime(view.time, language, null));
    add('battery', view.battery === null ? null : Math.round(view.battery));
    if (view.distanceKm !== null) {
      add('distance_home', Math.round(view.distanceKm * 10) / 10);
    }
    if (view.atHome !== null) {
      add('at_home', view.atHome ? 1 : 0);
    }
  }
  return states;
}
