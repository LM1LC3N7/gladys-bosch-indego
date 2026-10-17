# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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
  after.
- Scene trigger "Indego alert" on every new unread alert.
- "Test Indego" action; English and French texts and documentation.

[Unreleased]: https://github.com/LM1LC3N7/gladys-bosch-indego/commits/main
