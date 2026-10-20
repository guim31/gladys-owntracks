# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One Gladys device per phone of the OwnTracks Recorder: at home, presence
  signal, distance from home, battery, time of the last position, OwnTracks
  region.
- Live updates through the Recorder's WebSocket, with a fallback on its HTTP
  API while it is down; optional Basic auth for a Recorder behind a reverse
  proxy.
- Presence: "At home" by a radius around the Gladys house or by an OwnTracks
  region, and a "Presence" signal for the "Check user presence" scene action.
- Scene triggers: phone arrives home, leaves home, enters or leaves an
  OwnTracks region, no position received for 1 to 48 hours.
- Scene action "Get the position of a phone": a ready sentence, the region,
  the distance from home, the battery.
- Dashboard widget "Phones and presence".
- Coordinates kept in the container unless "Share coordinates" is enabled (map
  links); never in the logs.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-owntracks/commits/main
