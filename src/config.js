// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  password: '',
  house: '',
  home_radius: 150,
  home_region: '',
  presence_max_age: 120,
  share_coordinates: false,
  language: 'fr',
};

// Bounds of the number fields (the manifest declares the same, see the tests).
export const LIMITS = {
  home_radius: { min: 20, max: 5000 },
  presence_max_age: { min: 5, max: 1440 },
};

/**
 * Turn what the user typed into the base URL of the Recorder: `192.0.2.10`,
 * `192.0.2.10:8083`, `recorder.home` or a full URL with a path (behind a
 * reverse proxy, OTR_HTTPPREFIX). Without a port nor a scheme, the Recorder's
 * default HTTP port (8083) is assumed. Returns null when it is not usable.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
    return null;
  }
  if (url.username || url.password) {
    // Credentials in the URL would end up in logs and error messages.
    return null;
  }
  if (!hasScheme && url.port === '') {
    url.port = '8083';
  }
  // The address of a Recorder page works too: keep the prefix only.
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(api\/0|ws|last|map|table|view)(\/.*)?$/, '')
    .replace(/\/index\.html$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function integer(value, key) {
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    return DEFAULT_CONFIG[key];
  }
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawUrl = text(source.url);
  return {
    url: normalizeUrl(rawUrl),
    invalidUrl: rawUrl !== '' && normalizeUrl(rawUrl) === null,
    username: text(source.username),
    // A password may legitimately start or end with a space.
    password: typeof source.password === 'string' ? source.password : '',
    house: text(source.house),
    homeRadius: integer(source.home_radius ?? DEFAULT_CONFIG.home_radius, 'home_radius'),
    homeRegion: text(source.home_region),
    presenceMaxAge: integer(
      source.presence_max_age ?? DEFAULT_CONFIG.presence_max_age,
      'presence_max_age',
    ),
    shareCoordinates: source.share_coordinates === true || source.share_coordinates === 'true',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** True when the configuration can reach a Recorder. */
export function isConfigured(config) {
  return Boolean(config.url);
}
