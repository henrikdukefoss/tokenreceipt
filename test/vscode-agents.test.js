import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as cline from '../src/readers/cline.js';
import * as roo from '../src/readers/roo.js';
import * as kilo from '../src/readers/kilo.js';
import { editorDirs } from '../src/readers/vscode-tasks.js';
import { fixture, fixtureEnv, sqliteFromFixture } from './helpers.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const linux = { env: fixtureEnv(), platform: 'linux' };

test('editor user-data folders per platform', () => {
  const env = { TOKENRECEIPT_HOME: '/h', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' };
  assert.equal(editorDirs(env, 'darwin')[0], join('/h', 'Library', 'Application Support', 'Code'));
  assert.equal(editorDirs(env, 'linux')[3], join('/h', '.config', 'Cursor'));
  assert.equal(editorDirs(env, 'win32')[0], join('C:\\Users\\x\\AppData\\Roaming', 'Code'));
});

test('cline: legacy tasks (modelInfo, metadata fallback, subagent usage) + SDK sessions', async () => {
  const res = await cline.load(linux);
  assert.equal(res.found, true);
  const legacy = res.events.filter((e) => e.ts < 1758400000000);
  assert.deepEqual(
    legacy.map((e) => [e.model, e.input, e.output, e.cacheRead, e.cacheWrite]),
    [
      ['claude-sonnet-4-5', 1200, 400, 20000, 5000],
      ['claude-haiku-4-5', 300, 100, 25000, 0],
      ['claude-haiku-4-5', 500, 200, 0, 0],
    ],
  );
  const sdk = res.events.filter((e) => e.ts >= 1758400000000);
  assert.deepEqual(sdk.map((e) => [e.model, e.input, e.cacheRead, e.output]), [['gpt-5', 10000, 20000, 1500]]);
});

test('roo: model from <model> tag; tokensIn inclusive from v3.29.5 (2025-10-31)', async () => {
  const res = await roo.load(linux);
  assert.deepEqual(
    res.events.map((e) => [e.model, e.input, e.cacheRead, e.cacheWrite]),
    [
      ['claude-sonnet-4-5', 1000, 8000, 2000],
      ['claude-haiku-4-5', 2000, 9000, 1000],
    ],
  );
});

test('kilo: legacy tasks and kilo.db', async (t) => {
  const legacyOnly = await kilo.load({ ...linux, env: { ...fixtureEnv(), KILO_DB: '/nonexistent.db' } });
  assert.deepEqual(legacyOnly.events.map((e) => [e.model, e.input, e.cacheRead]), [['glm-4.6', 1000, 4000]]);
  const dir = mkdtempSync(join(tmpdir(), 'tokenreceipt-kilo-'));
  try {
    if (!(await sqliteFromFixture('kilo.sql', join(dir, 'kilo', 'kilo.db')))) return t.skip('no sqlite');
    const res = await kilo.load({ ...linux, env: { ...fixtureEnv(), XDG_DATA_HOME: dir } });
    assert.equal(res.events.filter((e) => e.agent === 'kilo-code').length, 4);
    assert.ok(!res.events.some((e) => e.model === 'legacy'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
