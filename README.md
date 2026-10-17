# gladys-bosch-indego

Unofficial [Gladys Assistant](https://gladysassistant.com) external
integration for **Bosch Indego** robotic mowers, through the Bosch cloud. Not
affiliated with Bosch.

- One device per mower: state (vacuum-cleaner category, like
  [gladys-automower](https://github.com/LM1LC3N7/gladys-automower) and
  [gladys-navimow](https://github.com/LM1LC3N7/gladys-navimow)), mow / pause
  select, back-to-the-station button, battery, activity, state code, mowing
  progress, next mowing, unread alerts, last alert, online.
- Live state through the long poll of the Bosch cloud; commands serialized
  per mower, with the state read right before and a 3.5 s budget.
- Scene trigger on every new unread alert.
- Sign-in with Bosch SingleKey ID in two steps (the address the sign-in ends
  on is pasted back), no browser extension.

**Never tested on a real account or mower yet**: see `TODO.md`.

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

## Credits

Built on what [sander1988/pyIndego](https://github.com/sander1988/pyIndego)
(MIT) and [sander1988/Indego](https://github.com/sander1988/Indego)
(Apache-2.0) found out about the Bosch cloud; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Development

```bash
npm install
npm test                 # node --test, against the SDK's fake Gladys and a fake Bosch cloud
npm run lint
npm run format:check
npm run audit            # npm audit --omit=dev
npm run validate:manifest
```

Architecture and rules: [CLAUDE.md](CLAUDE.md). Releases go through
**Actions → Release** (see the template's documentation).

## Security

The Bosch tokens are kept by Gladys in its database, in clear like every
configuration value, never logged. See [SECURITY.md](SECURITY.md) to report a
vulnerability.

## License

Apache-2.0 ([LICENSE](LICENSE)).
