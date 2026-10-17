// -----------------------------------------------------------------------------
// Text hygiene: no BOM and no mojibake (UTF-8 read as Latin-1: "Ã©", "Â ",
// "â€™"...) in the files users and the store read.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILES = [
  'gladys-assistant-integration.json',
  'docs/en.md',
  'docs/fr.md',
  'README.md',
  'CHANGELOG.md',
  'TODO.md',
  'CLAUDE.md',
  'THIRD_PARTY_NOTICES.md',
  'src/i18n.js',
];

// Built from code points so this file does not contain them itself.
const MOJIBAKE = [
  String.fromCodePoint(0xc3),
  String.fromCodePoint(0xc2),
  `${String.fromCodePoint(0xe2)}${String.fromCodePoint(0x20ac)}`,
];

test('no BOM, no mojibake', () => {
  for (const file of FILES) {
    const bytes = readFileSync(new URL(`../${file}`, import.meta.url));
    assert.ok(
      !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf),
      `${file} starts with a BOM`,
    );
    const text = bytes.toString('utf8');
    assert.ok(!text.includes('�'), `${file} is not valid UTF-8`);
    for (const bad of MOJIBAKE) {
      assert.ok(!text.includes(bad), `${file} contains mojibake (${JSON.stringify(bad)})`);
    }
  }
});
