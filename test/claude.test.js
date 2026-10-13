import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as claude from '../src/readers/claude.js';
import { fixture, fixtureEnv, sum } from './helpers.js';

test('claude: dedupes streamed duplicates, skips synthetic and corrupt lines', async () => {
  const res = await claude.load({ env: fixtureEnv() });
  assert.equal(res.found, true);
  const byModel = (m) => res.events.filter((e) => e.model === m);
  // msg_A1 (final count wins), msg_A2, msg_OLD, msg_S1 (no requestId, deduped by message.id)
  assert.equal(byModel('claude-sonnet-4-5').length, 4);
  assert.equal(byModel('claude-haiku-4-5-20251001').length, 1);
  assert.equal(byModel('<synthetic>').length, 0);
  const a1 = res.events.find((e) => e.input === 1000 && e.cacheRead === 200000);
  assert.equal(a1.output, 2000);
  assert.equal(sum(res.events, 'cacheRead'), 200000 + 300000 + 100000 + 50000);
  const a2 = res.events.find((e) => e.cacheRead === 300000);
  assert.equal(a2.cacheWrite1h, 20000);
});

test('claude: period filter', async () => {
  const res = await claude.load({ env: fixtureEnv(), sinceMs: Date.parse('2026-01-01') });
  assert.equal(res.events.some((e) => e.ts < Date.parse('2026-01-01')), false);
  assert.equal(res.events.length, 4);
});

test('claude: CLAUDE_CONFIG_DIR (comma separated) replaces the defaults', async () => {
  const env = { TOKENRECEIPT_HOME: '/nonexistent', CLAUDE_CONFIG_DIR: `/also-missing,${join(fixture('home'), '.claude')}` };
  assert.deepEqual(claude.roots(env), ['/also-missing/projects', join(fixture('home'), '.claude', 'projects')]);
  const res = await claude.load({ env });
  assert.equal(res.events.length, 5);
});

test('claude: missing directory is reported as not found', async () => {
  const res = await claude.load({ env: { TOKENRECEIPT_HOME: '/nonexistent' } });
  assert.equal(res.found, false);
});
