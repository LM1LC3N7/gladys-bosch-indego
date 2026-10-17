# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-17

### Added

- Sign-in with Bosch SingleKey ID (OAuth2 with PKCE) in two steps: the Connect
  button or the "Start the sign-in" action gives the address to open, the
  "Finish the sign-in" action takes the address the sign-in ended on. The
  tokens are kept by Gladys and renewed 5 minutes before they expire.
- One device per Indego mower: state, mow / pause select, back-to-the-station
  button, battery, activity, state code, mowing progress, next mowing, unread
  alerts, last alert, online.
- Live state through the long poll of the Bosch cloud (can be turned off),
  plus spaced reads; back-off on errors, every call paused on HTTP 429.
- Commands serialized per mower, with the state read right before, refused
  before sending when the cloud is too slow for Gladys' 5 s, and read back
  after. A stop (pause, back to the station) is always sent; a start is only
  skipped while the mower mows and no other command is pending. A request
  once sent is never cut: a late answer is reported as "sent, not confirmed".
- Clear sign-in messages (cancelled, refused, Bosch unreachable, address
  cut short by the console); the sign-in and the test answer at once and the
  mowers are read in the background.
- Battery, next mowing, alerts and mower details are read on their own: one
  of them failing never blocks the state.
- Scene trigger "Indego alert" on every new unread alert.
- "Test Indego" action; English and French texts and documentation.

[Unreleased]: https://github.com/LM1LC3N7/gladys-bosch-indego/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-bosch-indego/releases/tag/v0.1.1
