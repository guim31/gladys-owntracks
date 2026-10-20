// -----------------------------------------------------------------------------
// What the integration knows of one OwnTracks phone (a user/device pair of the
// Recorder): its latest location and the regions it is in, turned into a
// plain view the devices, the widget and the scene action share.
//
// OwnTracks payloads (checked on Recorder 1.0.4 and the OwnTracks JSON
// documentation): `lat`, `lon` in degrees, `acc` in meters, `batt` in
// percent, `tst` in seconds since the epoch. `inregions` lists the regions
// (OwnTracks waypoints) the phone is in, and is left out when it is in none —
// and by old apps that never send it: see Hub#applyLocation.
// -----------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance in kilometers. */
export function haversineKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** The key of a phone: its Recorder user and device (`alice/phone`). */
export function phoneKey(user, device) {
  return `${user}/${device}`;
}

/** The user and device of a Recorder message, or null. */
export function ownerOf(message) {
  let user = message?.username;
  let device = message?.device;
  if ((typeof user !== 'string' || typeof device !== 'string') && message?.topic) {
    // owntracks/<user>/<device>, as stored by the Recorder.
    const parts = String(message.topic).split('/');
    if (parts.length >= 3) {
      [user, device] = [parts[1], parts[2]];
    }
  }
  if (typeof user !== 'string' || typeof device !== 'string' || !user || !device) {
    return null;
  }
  return { user, device };
}

/** A usable location of a message (`_type: location`), or null. */
export function locationOf(message) {
  if (
    !message ||
    !finite(message.lat) ||
    !finite(message.lon) ||
    !finite(message.tst) ||
    Math.abs(message.lat) > 90 ||
    Math.abs(message.lon) > 180
  ) {
    return null;
  }
  return {
    latitude: message.lat,
    longitude: message.lon,
    accuracy: finite(message.acc) && message.acc >= 0 ? message.acc : null,
    battery: finite(message.batt) && message.batt >= 0 ? Math.min(100, message.batt) : null,
    time: message.tst * 1000,
  };
}

/** The region names of `inregions`, cleaned; null when the field is absent. */
export function regionsOf(message) {
  if (!Array.isArray(message?.inregions)) {
    return null;
  }
  return [
    ...new Set(
      message.inregions.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()),
    ),
  ];
}

/**
 * The home rule: an OwnTracks region named in the configuration, or else a
 * radius around the Gladys house. Null when neither is available.
 */
export function homeModeOf(config, house) {
  if (config.homeRegion) {
    return 'region';
  }
  return house ? 'house' : null;
}

export const PRESENCE_STATUSES = ['home', 'away', 'unknown'];

/**
 * @param {{ user: string, device: string, card: string | null,
 *   location: object | null, regions: string[] }} phone
 * @param {{ house: object | null, config: object }} context
 */
export function viewOf(phone, { house, config }) {
  const { location } = phone;
  const located = location !== null;
  const distanceKm = located && house ? haversineKm(location, house) : null;

  let atHome = null;
  const mode = homeModeOf(config, house);
  if (located && mode === 'region') {
    const wanted = config.homeRegion.toLowerCase();
    atHome = phone.regions.some((name) => name.toLowerCase() === wanted);
  } else if (located && mode === 'house') {
    atHome = distanceKm * 1000 <= config.homeRadius;
  }

  return {
    key: phoneKey(phone.user, phone.device),
    name: `${phone.card || phone.user} (${phone.device})`.slice(0, 60),
    user: phone.user,
    device: phone.device,
    hasPosition: located,
    latitude: located ? location.latitude : null,
    longitude: located ? location.longitude : null,
    accuracy: located ? location.accuracy : null,
    battery: located ? location.battery : null,
    time: located ? location.time : null,
    regions: phone.regions,
    distanceKm,
    atHome,
    status: atHome === null ? 'unknown' : atHome ? 'home' : 'away',
  };
}

/** A link the scene can send (OpenStreetMap, no account, no key). */
export function mapUrl(view) {
  if (!view.hasPosition) {
    return '';
  }
  const lat = view.latitude.toFixed(5);
  const lon = view.longitude.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}
