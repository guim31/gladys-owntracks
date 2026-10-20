# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration holds:

- the optional user name and password of a reverse proxy in front of the
  Recorder (Basic auth), in the Gladys configuration (the password in a
  `secret` field, never sent back to the browser by Gladys) — never in `/data`,
  never in the logs;
- nothing in `/data`: the positions and regions live in memory only;
- the location of the Gladys house (manifest `location: true`), read to compute
  the distance from home, kept in memory;
- the coordinates of the phones, kept in memory and sent to Gladys only when
  the administrator enables "Share coordinates" (then as OpenStreetMap links);
  never written in the logs, nor the region names;
- network: HTTP(S) and WebSocket connections to the Recorder address the
  administrator entered. No other outbound connection. Redirects are not
  followed, so the credentials are never sent to another address.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and OwnTracks itself, apps and Recorder (report to its maintainers, see
[owntracks/recorder](https://github.com/owntracks/recorder)).
