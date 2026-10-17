# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Bosch Indego robotic mowers
(Bosch cloud, Bosch SingleKey ID sign-in): a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template;
the Bosch logic is ported from sander1988/pyIndego (MIT) and sander1988/Indego
(Apache-2.0), see THIRD_PARTY_NOTICES.md. TODO.md holds the status and the
decisions.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/devices.test.js          # one file
node --test --test-name-pattern "plug"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK bootstrap only
src/handlers.js                   every SDK handler -> IndegoApp (shared with the tests)
src/app.js                        sign-in, reading loop, long poll, commands, alerts trigger, test
src/devices.js                    Gladys devices and states (pure)
src/i18n.js                       every user-facing text, en/fr
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
src/constants.js                  Bosch URLs/paths/client, pacing, manifest keys
src/http.js                       the only fetch (timeout, User-Agent, bounded read)
src/indego/auth.js                SingleKey ID: PKCE, pasted address, token, renewal
src/indego/client.js              Indego API calls + error classification
src/indego/errors.js              IndegoError, Retry-After, readable reasons
src/indego/model.js               answers -> values (state codes, battery, next mow, alerts)
gladys-assistant-integration.json manifest: name, config_schema, actions, trigger, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, SDK fake Gladys + fake Bosch cloud (helpers/)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords, codes or API keys. The Bosch
  tokens live in the config key `indego_token` (outside the config_schema),
  stored by Gladys in clear: never write "encrypted" in a doc.
- **Commands are physical.** One at a time per mower, the state read right
  before (never decide on the state in memory), refused before sending when
  the 3.5 s budget is spent. A 429 pauses every path, commands included.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
