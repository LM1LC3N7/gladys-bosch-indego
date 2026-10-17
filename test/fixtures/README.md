# Test fixtures

Made-up answers of the Bosch cloud, no real account behind them:

- `state-docked.json`, `operating.json`, `generic.json`, `nextcutting.json`
  and the first entry of `alerts.json` are the sample answers of
  sander1988/pyIndego's tests (`tests/test_indego.py`, MIT), with the serial,
  the dates and a name changed; `state-mowing.json`, `generic-old.json` and
  the second alert are variations of them.
- `token.json` and `token-renewed.json` follow the token answer of Azure AD
  B2C (Microsoft's documentation); `invalid-grant.json` its refusal of an
  expired refresh token (AADB2C90080).
- `alms.json`: the mower list (`alm_sn` is what pyIndego reads; `alm_name`
  in the list is a guess, the name is read from `alms/<serial>`).
