import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as hermes from '../src/readers/hermes.js';
import { sqliteFromFixture } from './helpers.js';

async function withDb(sql, fn, t) {
  const dir = mkdtempSync(join(tmpdir(), 'tokenreceipt-hermes-'));
  try {
    if (!(await sqliteFromFixture(sql, join(dir, 'state.db')))) return t.skip('no sqlite');
    await fn({ HERMES_HOME: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('hermes: per-model totals from session_model_usage, including helper tasks', (t) =>
  withDb('hermes.sql', async (env) => {
    const all = await hermes.load({ env });
    assert.deepEqual(all.events.map((e) => [e.model, e.requests, e.input, e.cacheRead]).sort(), [
      ['claude-sonnet-4-5', 12, 6000, 80000],
      ['gemini-2.5-flash', 2, 800, 0],
      ['gpt-5', 3, 1000, 0],
    ]);
    const recent = await hermes.load({ env, sinceMs: Date.parse('2026-01-01') });
    assert.equal(recent.events.length, 2);
  }, t));

test('hermes: older databases fall back to session totals', (t) =>
  withDb('hermes-old.sql', async (env) => {
    const res = await hermes.load({ env });
    assert.deepEqual(res.events.map((e) => [e.model, e.output, e.cacheWrite]), [['claude-sonnet-4-5', 2000, 9000]]);
  }, t));
