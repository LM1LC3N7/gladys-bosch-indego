// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCOUNT_KEY, ACTIONS, LANGUAGES, SCENE_TRIGGERS, TOKEN_KEY } from '../src/constants.js';
import { BOUNDS, DEFAULTS, normalizeConfig } from '../src/config.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const app = read('src/app.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length <= 30, 'the store refuses a name over 30 characters');
  assert.match(manifest.gladys_version, />=5\.1\.0/);
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-bosch-indego:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.equal(
    JSON.parse(read('package-lock.json')).version,
    manifest.version,
    'package-lock.json',
  );
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-bosch-indego/main/cover.png',
  );
  assert.deepEqual(manifest.categories, ['appliances']);
  assert.deepEqual(manifest.transports, ['cloud']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(manifest.config_schema[0].description[lang], /Unofficial|non officiel/);
    assert.match(manifest.config_schema[0].description[lang], /Never tested|Jamais testé/);
    assert.match(read(`docs/${lang}.md`), /not affiliated with Bosch|sans lien avec Bosch/);
  }
  for (const field of manifest.config_schema) {
    for (const link of field.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
    if (field.type === 'section') {
      for (const lang of ['en', 'fr']) {
        assert.ok(field.description[lang].length <= 1000, `${field.key}.${lang} too long`);
      }
    }
  }
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the token is kept in clear: no text claims it is encrypted', () => {
  for (const file of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'src/i18n.js',
  ]) {
    assert.doesNotMatch(read(file), /\bencrypt|\bchiffr/i, file);
  }
  for (const lang of ['en', 'fr']) {
    assert.match(read(`docs/${lang}.md`), /in clear|en clair/);
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.equal(fields[ACCOUNT_KEY].type, 'account_link');
  assert.equal(fields[TOKEN_KEY], undefined, 'the token lives outside the config_schema');
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
    if (BOUNDS[key]) {
      assert.deepEqual([fields[key].min, fields[key].max], BOUNDS[key], key);
    }
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  const defaults = normalizeConfig();
  assert.deepEqual(
    [defaults.pollMinutes, defaults.longpoll, defaults.language],
    [DEFAULTS.poll_minutes, DEFAULTS.longpoll, DEFAULTS.language],
  );
  assert.equal(normalizeConfig({ poll_minutes: 1 }).pollMinutes, 2);
  assert.equal(normalizeConfig({ poll_minutes: '600' }).pollMinutes, 60);
  assert.equal(normalizeConfig({ longpoll: false }).longpoll, false);
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), name);
  }
  const finish = manifest.actions.find((a) => a.key === ACTIONS.FINISH);
  assert.deepEqual(
    finish.fields.map((f) => [f.key, f.type, f.required]),
    [['url', 'string', true]],
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key),
    Object.values(SCENE_TRIGGERS),
  );
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
  // Every field and variable of the trigger is a key of the event the code fires.
  const [trigger] = manifest.scene_triggers;
  for (const { key } of [...trigger.fields, ...trigger.variables]) {
    assert.match(app, new RegExp(`\\b${key}:`), `${key} is in the event data`);
  }
});
