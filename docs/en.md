# Bosch Indego

Unofficial connector, not affiliated with Bosch. Indego and Bosch are
trademarks of their owner.

This integration reads your **Bosch Indego** robotic mowers through the Bosch
cloud, with the Bosch SingleKey ID account of the Bosch Indego app, and lets
Gladys start, pause and send them back to their station.

> **Never tested on a real account or mower yet.** It follows what the Home
> Assistant integration (sander1988/Indego) and its library
> (sander1988/pyIndego) do, and was tested against sample answers only. If
> something looks wrong, open an issue with the integration logs.

## What you get

One device per mower of the account:

| Feature             | What it shows                                                                        |
| ------------------- | ------------------------------------------------------------------------------------ |
| State               | Running, paused, returning to dock, charging, docked, error, stopped                 |
| Mow / pause         | Select: _Mow_ starts mowing, _Pause_ stops the mower where it is                     |
| Back to the station | Button: sends the mower back to its station                                          |
| Battery             | Level in %                                                                           |
| Activity            | The detailed state, as text ("Mowing, relocalising", "Stuck on the lawn"...)         |
| State code          | The raw Bosch state code (for scenes and troubleshooting)                            |
| Mowing progress (%) | How much of the lawn was mowed in the current run                                    |
| Next mowing         | The next mowing planned by SmartMowing, in the time of the garden, or "None planned" |
| Unread alerts       | Number of unread alerts of the Bosch cloud for this mower                            |
| Last alert          | Headline and message of the newest alert                                             |
| Online              | 0 when the cloud reports the mower offline                                           |

A scene trigger, **Indego alert**, fires once for every new unread alert
(stuck, lifted, blade reminder...), with the mower, the error code, the
headline, the message and the level as variables. The alerts already there
when the integration starts never fire.

## Signing in

Bosch SingleKey ID only sends the sign-in back to the Bosch Indego app (an
address starting with `com.bosch.indegoconnect://`), which no browser can
open. The integration therefore signs in in two steps, without any browser
extension:

1. In the **Configuration** tab, click **Connect** next to "Bosch SingleKey
   ID account" (or the **Start the sign-in** action at the bottom, which
   shows the same kind of address as text). Open the address in a computer
   browser (Chrome, Edge, Firefox).
2. **Before signing in**, open the developer tools of the browser: **F12**,
   then the **Console** tab.
3. Sign in with your Bosch SingleKey ID (the e-mail and password of the
   Indego app). At the end the page stops, and the console shows a line
   like:
   `Failed to launch 'com.bosch.indegoconnect://login?state=…&code=…' because the scheme does not have a registered handler.`
   If the console shows nothing (Firefox), open the **Network** tab instead,
   click the last request named `authresp`, and copy the value of its
   **Location** response header.
4. Copy that address (or the whole console line: the integration finds the
   address in it) into the **Finish the sign-in** action, then click it,
   **within 15 minutes** (the code expires quickly and serves once).

The action answers "Signed in: N mowers found". The mowers then show up in
the **Discovery** tab: add them.

### What is kept, and where

The integration never sees your password: Bosch's page takes it. After the
sign-in, Gladys keeps a **renewal token** (and the short-lived access token)
in its database, **in clear** like every configuration value of an
integration (and so in its backups): it is never shown again in the
interface and is sent only to Bosch. Anyone who can read the Gladys database
or a backup can use it to reach your Indego account: protect them
accordingly. To revoke it, change your Bosch SingleKey ID password or end the
session from your Bosch account.

The token is renewed by itself, 5 minutes before it expires. If Bosch refuses
the renewal (password changed, session revoked, unused for too long), the
integration stops calling Bosch and the connection status asks you to sign in
again: start over at step 1.

## Settings

- **Refresh interval while mowing** (5 min by default, 2 to 60): how often
  the state and the mowing progress are read while the mower is out of its
  station (and all the time when the live state is off).
- **Live state (long poll)** (on by default): the Bosch cloud holds one
  request per mower and answers as soon as the state changes, or after about
  4 minutes. Turn it off if your network cuts long requests: the state is
  then read at the interval above.
- **Language** of the feature names (set when the mower is added) and of the
  texts (activity, next mowing, last alert).

## Use of the Bosch cloud

The Bosch cloud documents no limit. The integration stays below what the Home
Assistant integration does:

- the long poll: one pending request per mower, never two within 30 seconds;
- the state every 5 minutes (setting) while the mower is out, for the
  progress;
- the battery every 10 minutes while the mower is out or charging, every 6
  hours otherwise;
- alerts and next mowing every 10 minutes; the mower list every 12 hours and
  on a Discovery scan;
- around a command: the state read right before, then 10 s and 45 s after.

On errors it waits 30 s, 1, 2, 5, 10 then 15 minutes between tries. An HTTP
429 (too many requests) pauses **every** call, commands included, for the
time Bosch asks (1 minute to 6 hours; 5 minutes when it does not say).

## Commands

The **Mow / pause** select and the **Back to the station** button send the
`mow`, `pause` and `returnToDock` commands of the Bosch cloud. For each
command the integration:

- runs one command at a time per mower;
- reads the state of the mower right before, and does **not** send the
  command when the state cannot be read, the mower is offline, or the
  command would change nothing (back to the station while docked);
- refuses the command, before sending anything, when the cloud is too slow
  to answer within 3.5 seconds (Gladys gives up after 5 seconds): Gladys
  then shows an error and nothing was sent; try again;
- reads the state back 10 and 45 seconds later.

## Actions of the Configuration screen

- **Start the sign-in**: shows a sign-in address (see above).
- **Finish the sign-in**: takes the pasted address.
- **Test Indego**: reads the mowers of the account and shows the state and
  battery of each.

## Troubleshooting

- _"This address does not belong to a sign-in started in the last 15
  minutes"_: click **Start the sign-in** (or Connect) again and use the new
  address; each address serves once.
- _"Bosch refused the sign-in (invalid_grant …)"_: the code expired or was
  already used: start over.
- _"The Indego cloud gateway refuses the calls"_ (HTTP 403): the Azure
  gateway in front of the API blocks some requests; the integration tries
  again by itself.
- The logs never contain a token, a code or a password. Set `LOG_LEVEL=debug`
  for more detail.

## Credits

The API, the sign-in, the state codes and the battery scale come from
[sander1988/pyIndego](https://github.com/sander1988/pyIndego) (MIT) and
[sander1988/Indego](https://github.com/sander1988/Indego) (Apache-2.0), the
Home Assistant integration. See `THIRD_PARTY_NOTICES.md`.
