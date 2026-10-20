// -----------------------------------------------------------------------------
// HTTP client of the OwnTracks Recorder (checked on Recorder 1.0.4).
//
// The Recorder has no authentication of its own: when it sits behind a
// reverse proxy, Basic auth is the usual guard, hence the optional user name
// and password, sent on every request and on the WebSocket.
//
// `GET /api/0/last` answers the latest location of every user/device. A card
// (`_type: card`) adds its `name`, and its `face`, a base64 picture that can
// weigh tens of kilobytes per phone: the `fields` parameter keeps only what
// the integration reads.
// -----------------------------------------------------------------------------

export const REQUEST_TIMEOUT_MS = 15_000;

export const LAST_FIELDS = [
  'username',
  'device',
  'name',
  'tid',
  'lat',
  'lon',
  'acc',
  'batt',
  'tst',
  'inregions',
];

/** An error of the Recorder link, with a stable code for the messages. */
export class RecorderError extends Error {
  /**
   * @param {'unreachable' | 'unauthorized' | 'http' | 'invalid'} code
   * @param {string} message never holds a secret
   * @param {number} [status]
   */
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** The Authorization header of Basic auth, or null without a user name. */
export function basicAuth(username, password) {
  if (!username) {
    return null;
  }
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

export class RecorderClient {
  /**
   * @param {{ url: string, username?: string, password?: string,
   *   fetch?: typeof fetch, timeout?: number }} options
   */
  constructor({ url, username = '', password = '', fetch = globalThis.fetch, timeout }) {
    this.url = url;
    this.authorization = basicAuth(username, password);
    this.fetch = fetch;
    this.timeout = timeout ?? REQUEST_TIMEOUT_MS;
  }

  /** The headers of every request, and of the WebSocket. */
  headers() {
    return this.authorization ? { Authorization: this.authorization } : {};
  }

  /** GET a JSON resource of the API. */
  async get(path) {
    let response;
    try {
      response = await this.fetch(`${this.url}${path}`, {
        headers: { Accept: 'application/json', ...this.headers() },
        // A redirect would carry the credentials to another address.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
      throw new RecorderError('unreachable', `the Recorder is unreachable (${reason})`);
    }
    const route = path.split('?')[0];
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new RecorderError(
        'unauthorized',
        `the Recorder refused ${route} (HTTP ${response.status})`,
        response.status,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new RecorderError(
        'http',
        `the Recorder answered HTTP ${response.status} on ${route}`,
        response.status,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new RecorderError(
        'invalid',
        `the Recorder sent an answer that is not JSON on ${route}`,
      );
    }
  }

  /** `{ version, git }`. */
  getVersion() {
    return this.get('/api/0/version');
  }

  /** The user names the Recorder knows. */
  async getUsers() {
    const answer = await this.get('/api/0/list');
    return Array.isArray(answer?.results)
      ? answer.results.filter((u) => typeof u === 'string')
      : [];
  }

  /** The latest location of every user/device. */
  async getLast() {
    const answer = await this.get(`/api/0/last?fields=${LAST_FIELDS.join(',')}`);
    if (!Array.isArray(answer)) {
      throw new RecorderError('invalid', 'the Recorder sent no list of locations');
    }
    return answer;
  }
}
