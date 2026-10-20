# OwnTracks for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[OwnTracks](https://owntracks.org), the free and private location app for
Android and iOS, through your own
[OwnTracks Recorder](https://github.com/owntracks/recorder): every phone
becomes a Gladys device that says whether it is at home, how far from home it
is, which OwnTracks region it is in and its battery; scenes react when a phone
comes home, leaves, enters or leaves a region, or stops sending positions.

Tested against a real OwnTracks Recorder 1.0.4 (official Docker image) with
simulated phones, not with phones on the road. **Developed without the
hardware: feedback welcome.** For GPS trackers and vehicles, see
[gladys-traccar](https://github.com/guim31/gladys-traccar); for the location
history and statistics,
[gladys-dawarich](https://github.com/guim31/gladys-dawarich).

## Features

- **One device per phone** (user/device of the Recorder): at home, presence
  signal, distance from home (km), battery, time of the last position,
  OwnTracks region.
- **Live**: the Recorder's WebSocket (`/ws/last`) pushes every position; while
  it is down, `/api/0/last` is read every minute and the missed crossings fire
  late.
- **Presence**: at home by a radius around the Gladys house or by an OwnTracks
  region, and a "seen at home" signal for the core's "Check user presence"
  scene action.
- **Scene triggers**: phone arrives home, leaves home, enters or leaves an
  OwnTracks region, no position received for 1 to 48 hours.
- **Scene action** "Get the position of a phone": a ready-made sentence and the
  values.
- **Dashboard widget** "Phones and presence".
- **Private**: coordinates stay in the container unless you enable "Share
  coordinates" (map links); no coordinates nor region names in the logs. Read
  only, local network only.
- English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- An OwnTracks Recorder reachable from Gladys (port 8083 by default), fed by the
  OwnTracks app through MQTT or HTTP. Optional Basic auth when a reverse proxy
  protects it.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-owntracks` (or find **OwnTracks** in the
   catalog).
2. In **Configuration**, enter the address of the Recorder
   (`http://192.168.1.20:8083`), save, and click **Test the connection**.
3. Add the phones from the **Discovery** tab.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

At start and at every reconnection of the WebSocket, the container reads
`GET /api/0/last?fields=…` (the latest location of every user/device, without
the pictures of the OwnTracks cards), then listens to `/ws/last`, where the
Recorder pushes every `location` and `transition` it receives. The Recorder
sends no keep-alive and echoes what it receives: the container sends `ping`
every 30 seconds and reconnects when no echo comes back.

Regions come from the `inregions` list of the locations and from the
`transition` messages of the app; each enter or leave fires once whichever
says it first. An app that has never sent `inregions` keeps the regions of its
transitions. The first state read after a start is a baseline: nothing fires
for what was already there.

## Limitations

- Read only: nothing is ever sent to the phones.
- The latest position only, no history.
- At home compares the position with the house as it is, without its accuracy.
- Not tested with real phones on the road.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests + a simulated Recorder
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
```

```
index.js                     SDK wiring (src/app.js registers the handlers)
src/hub.js                   phones, states, triggers, presence, connection status
src/model.js                 Recorder message -> phone view (regions, home, distance)
src/devices.js               phone view -> Gladys device and states
src/owntracks/client.js      HTTP client (optional Basic auth)
src/owntracks/socket.js      WebSocket /ws/last with pings and reconnection
src/widgets.js               "Phones and presence" dashboard widget
src/scenes.js                scene action
src/texts.js                 every text, in four languages
test/                        node --test; the SDK's fake Gladys, a simulated Recorder
test/fixtures/recorder-1.0.4/  real Recorder 1.0.4 answers (test server, fake data)
```

`test/gladys-rules.test.js` checks every discovered device against the
category/type table extracted from the Gladys core.

To run it outside Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="owntracks" \
npm start
```

Releases are made by the **Release** workflow (Actions → Release); never edit
the versions by hand. A hand-pushed `vX.Y.Z` tag also builds the image and the
GitHub Release, but then `version` in `package.json` and in the manifest (with
the `docker_image` tag) must be bumped and committed before tagging. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [OwnTracks](https://owntracks.org) and the
  [OwnTracks Recorder](https://github.com/owntracks/recorder) by Jan-Piet Mens,
  Christoph Krey and contributors (GPL-2.0-or-later): the apps, the Recorder,
  its API and the JSON format documentation. No code of the Recorder is
  included; the integration only talks to its HTTP API.
- The cover uses the official OwnTracks logo (`OwnTracks.svg`), from the
  [owntracks/frontend](https://github.com/owntracks/frontend) repository (MIT).

## Disclaimer

This project is not affiliated with, endorsed by or sponsored by the OwnTracks
project. OwnTracks is a name of its owners.

## License

[Apache-2.0](LICENSE).
