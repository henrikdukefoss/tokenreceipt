import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as opencode from '../src/readers/opencode.js';
import { fixture, fixtureEnv } from './helpers.js';

test('opencode: legacy storage/message JSON files', async () => {
  const res = await opencode.load({ env: fixtureEnv() });
  assert.equal(res.found, true);
  assert.equal(res.events.length, 2); // user message skipped
  const gw = res.events.find((e) => e.model === 'standardcompute');
  assert.equal(gw.output, 2500); // reasoning counted as output
  assert.equal(gw.cacheRead, 90000);
});

async function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'tokenreceipt-oc-'));
  const db = join(dir, 'opencode', 'opencode.db');
  mkdirSync(join(dir, 'opencode'));
  const sql = readFileSync(fixture('opencode.sql'), 'utf8');
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const h = new DatabaseSync(db);
    h.exec(sql);
    h.close();
  } catch {
    try {
      execFileSync('sqlite3', [db], { input: sql });
    } catch {
      rmSync(dir, { recursive: true, force: true });
      return null;
    }
  }
  return dir;
}

test('opencode: SQLite opencode.db (node:sqlite or sqlite3 CLI)', async (t) => {
  const dir = await makeDb();
  if (!dir) return t.skip('neither node:sqlite nor sqlite3 available');
  try {
    const res = await opencode.load({ env: { XDG_DATA_HOME: dir } });
    assert.equal(res.found, true, JSON.stringify(res.warnings));
    assert.equal(res.events.length, 3);
    const gpt = res.events.filter((e) => e.model === 'gpt-5');
    assert.equal(gpt.length, 2);
    assert.equal(gpt.find((e) => e.input === 1000).output, 300);
    const recent = await opencode.load({ env: { XDG_DATA_HOME: dir }, sinceMs: Date.parse('2025-01-01') });
    assert.equal(recent.events.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('opencode: falls back to the sqlite3 CLI when node:sqlite is unavailable', async (t) => {
  try {
    execFileSync('sqlite3', ['-version'], { stdio: 'ignore' });
  } catch {
    return t.skip('sqlite3 CLI not installed');
  }
  const dir = await makeDb();
  const { querySqlite } = await import('../src/lib/sqlite.js');
  process.env.TOKENRECEIPT_NO_NODE_SQLITE = '1';
  try {
    // module caches the node:sqlite probe, so call a fresh copy
    const fresh = await import(`../src/lib/sqlite.js?cli=${Date.now()}`);
    const { rows } = await fresh.querySqlite(join(dir, 'opencode', 'opencode.db'), 'SELECT id FROM message ORDER BY id');
    assert.deepEqual(rows.map((r) => r.id), ['msg_db1', 'msg_db2', 'msg_db3', 'msg_db4']);
    assert.equal(typeof querySqlite, 'function');
  } finally {
    delete process.env.TOKENRECEIPT_NO_NODE_SQLITE;
    rmSync(dir, { recursive: true, force: true });
  }
});
