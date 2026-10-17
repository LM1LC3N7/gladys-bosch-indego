# TODO — Bosch Indego v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own, no forum post from a module session: the
  batch claimed in /t/10385 (post #226) gets one recap message there.

## Status

- [x] **Milestone 1 — core** (2026-10-17): Bosch SingleKey ID sign-in (Azure
      AD B2C, authorization code with PKCE S256, the public client of the
      Indego app) in two steps: `account_link` Connect button or
      `start_sign_in` action give the address to open; the `finish_sign_in`
      action takes the address the sign-in ended on (the
      `com.bosch.indegoconnect://login?state=…&code=…` address, the console
      line, its encoded form, or the bare query);
      sign-ins kept 15 min (5 at most), each serves once; tokens stored
      off-schema with `setConfig` (`indego_token`), renewed 5 min before
      expiry (back-off 1/5/15/60 min on network failures, a refusal stops
      everything until a new sign-in). Mower list (`alms`) + `alms/<serial>`
      at start, every 12 h and on a scan; long poll of the state per mower
      (230 s, `last`, 504 = no change, never two within 30 s); plain state
      read every `poll_minutes` (5) while the mower is out (all the time
      without long poll); battery (`operatingData`) every 10 min while out or
      charging, 6 h otherwise; alerts and next mowing every 10 min, alerts at
      once when `state.error` changes. Failures: 30 s → 15 min back-off; 429:
      every path paused for Retry-After (1 min–6 h, 5 min without). One device
      per mower (vacuum-cleaner state / run mode / dock, battery, activity,
      state code, progress, next mowing, unread alerts, last alert, online);
      commands mow / pause / returnToDock serialized per mower, state read
      right before (refused if unreadable, offline, or after 3.5 s), skipped
      when they change nothing, read back after 10 s and 45 s; scene trigger
      `mower_alert`; "Test Indego"; en/fr. Tested against sample answers
      (pyIndego's test data) and a fake Bosch cloud only; Node 22 and 24. No
      Docker end-to-end test (no Docker on this PC).
- [ ] **Milestone 2 — real account**: sign in with a real Bosch SingleKey ID
      and a real mower, compare with the app (see "To check on a real
      account"); turn the answers (anonymized) into fixtures.
- [ ] **Milestone 3 — more**: scene actions (mow, pause, dock) and a widget
      like gladys-navimow; triggers on state changes (mowing finished, back
      in the station, error); SmartMowing on/off (`alms/<serial>/predictive`);
      the lawn map (`alms/<serial>/map`, SVG); read / delete alerts.
- [ ] **Milestone 4 — first release**: Docker image build check, store
      validator, Release workflow (0.1.0 → 0.1.1), topic, GHCR package public.

## To check on a real account

- **The sign-in path**: that B2C accepts the PKCE parameters with this client
  (sander1988/Indego sends none: it should simply ignore or verify them), and
  that the authorize address with `response_mode=query` ends on
  `com.bosch.indegoconnect://login?state=…&code=…` (302 from `authresp`).
- **What the browser shows**: Chrome / Edge log "Failed to launch
  'com.bosch.indegoconnect://…'" in the console; Firefox? Safari? Whether the
  Network tab keeps the `authresp` request (the "Preserve log" option may be
  needed).
- **What the Gladys front does with the `account_link` URL** (new tab?): the
  `start_sign_in` action is the fallback either way.
- The token answer: `expires_in` (the Home Assistant integration treats a
  token with less than 12 h left as expired: longer than 1 h?),
  `refresh_token_expires_in`, whether each renewal returns a new refresh
  token, and how long a session lasts without a new sign-in (B2C defaults:
  14-day sliding window, 90 days max?).
- The scope string: whether the token endpoint needs it on the code
  exchange and the renewal (sent on both here).
- `alms`: the fields of the list (only `alm_sn` is used; the name comes from
  `alms/<serial>`).
- `state`: a real long poll (does `last` hold the request until the state
  code changes? what does it return after 230 s: 504 or 204?), `mowed`
  during a run, `error` values.
- `operatingData`: whether reading it wakes a sleeping mower, and the battery
  scale of the current models.
- `predictive/nextcutting` without SmartMowing (204? 404? an empty body?).
- `alerts`: `alm_sn` present on each alert; `read_status` values.
- `PUT state`: the answer (200 empty? the new state?), the answer when the
  mower is offline or lifted, and how fast the state follows (read back at
  10 s and 45 s).
- Rate limits: none documented; watch for HTTP 429 and the Azure 403.
- The User-Agent `gladys-bosch-indego/0.1 (+…)`: the Azure gateway blocked
  some default ones (pyIndego #119); if it is refused, try the app's.

## Decisions

- **Not a duplicate** (checked 2026-10-17): the store index has no Indego
  integration (mowers in the store: LM1LC3N7/gladys-automower,
  LM1LC3N7/gladys-navimow, Nagromdark/gladys-gardena, a Worx Landroid one…;
  guim31/gladys-bosch-homecom is Bosch heating, not mowers).
- **Reuse** (Louis's rule: maintained work first): pyIndego 3.2.3 (MIT,
  July 2026) and sander1988/Indego 6.2.0 (Apache-2.0, October 2026, active)
  are Python; ported to small JavaScript on `fetch` (credited in
  THIRD_PARTY_NOTICES.md and the file headers). No npm library exists for
  Indego. No runtime dependency besides the SDK.
- **Sign-in without a browser in the container**: Bosch's client only
  redirects to `com.bosch.indegoconnect://login`, so Gladys' `oauth2` relay
  cannot work (it needs Gladys' redirect address). sander1988/Indego solves
  it with a browser extension that catches the redirect; here the user copies
  the address from the developer tools and pastes it in an action, which is
  feasible and clean (PKCE verifier and state kept in memory, 15 min,
  single use). An `account_link` field gives a Connect button that opens the
  address; the `start_sign_in` action shows it as text, as a fallback.
- **Tokens with `setConfig`** under `indego_token` (outside the
  config_schema): they survive a restart and an image update. Gladys stores
  them **in clear** in its database (and backups), never shown again; the
  docs say so. Never logged (tests check the logs).
- **Category `vacuum-cleaner`** like gladys-automower and gladys-navimow;
  run mode Clean = `mow`, Idle = `pause`, the dock button = `returnToDock`.
  Progress, state code and alert count are `unknown`/`integer` **without a
  unit** (the core lists no unit for that category); the battery is
  `battery`/`integer` in %.
- **Commands**: one at a time per mower (a queue); the 3.5 s budget starts
  when Gladys sends the command, queue included; the state is read with the
  budget minus 1.2 s; the command is not sent when less than 1.2 s remain,
  when the state cannot be read, when the mower is offline (99999), or when
  it would change nothing; the command never renews the token (no time):
  an expired token refuses it.
- **Long poll on by default** (the Home Assistant integration's way):
  fewer requests than plain polling and a live state; a switch turns it off.
- **Alerts trigger**: only alerts that appear after the first read and are
  unread; one event each.
- **Version 0.1.0** set by hand in package.json, package-lock.json, the
  manifest and the `docker_image` tag (the first Release `patch` gives
  0.1.1).
