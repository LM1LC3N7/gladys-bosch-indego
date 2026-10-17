# Third-party notices

## sander1988/pyIndego (https://github.com/sander1988/pyIndego)

The Bosch Indego library in Python, version 3.2.3 (commit a9ce33c of
2026-07-23), MIT. Ported to JavaScript here, adapted:

- `src/constants.js`: the API address, the paths (`alms`, `alms/<serial>`,
  `/state`, `/operatingData`, `/predictive/nextcutting`, `alerts`), the three
  commands (`mow`, `pause`, `returnToDock`), the long poll parameters
  (`longpoll`, `timeout` capped at 230 s, `last`) and the advice on the
  User-Agent;
- `src/indego/model.js`: the state code table
  (`MOWER_STATE_DESCRIPTION_DETAIL`, grouped into activities), the model
  table (`MOWER_MODEL_DESCRIPTION`), the battery scale of the first models
  (`MOWER_MODEL_VOLTAGE`, 285 to 369), the date format of the answers;
- `src/i18n.js`: the state texts, translated;
- `src/indego/client.js`: a 504 of the long poll means "no change", a 204
  "no content";
- `test/fixtures/`: the sample answers of `tests/test_indego.py`, with the
  serial, dates and names changed.

```text
Copyright (c) 2019 The Python Packaging Authority

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## sander1988/Indego (https://github.com/sander1988/Indego)

The Home Assistant integration built on pyIndego, version 6.2.0 (commit
8541734 of 2026-10-09), Apache License 2.0 (the license of this repository
too, see `LICENSE`). Adapted, rewritten in JavaScript:

- the Bosch SingleKey ID sign-in (`custom_components/indego/const.py`,
  `api.py`, `config_flow.py`): the Azure AD B2C authorize and token
  addresses, the public client id of the Bosch Indego app, its redirect
  `com.bosch.indegoconnect://login`, the scopes; the way its browser
  extension finds the code in the redirect the browser cannot follow
  (`browser_extension/`), replaced here by an address pasted by the user;
- the pacing of `__init__.py`: the long poll of the state (230 s), the
  operating data read while the mower works or charges, the 10-minute
  refresh of alerts and next mowing, the alerts read again when the state
  reports a new error, a 60-second pause of the token renewal on a passing
  failure (longer here).

No file of it is copied as is. The Apache License 2.0 text is in `LICENSE`.

## Runtime dependencies

- `@gladysassistant/integration-sdk` (Apache-2.0) and its dependency `ws`
  (MIT), installed from npm into the image with their own licence files.
