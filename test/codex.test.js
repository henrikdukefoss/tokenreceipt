import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as codex from '../src/readers/codex.js';
import { fixture, fixtureEnv, sum } from './helpers.js';

const sessions = join(fixture('home'), '.codex', 'sessions');

test('codex (new format): token_usage_record per response, deduped by response_id, token_count ignored', async () => {
  const events = await codex.parseFile(join(sessions, '2026/09/20/rollout-2026-09-20T12-00-00-019a-new.jsonl'));
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.model === 'gpt-5-codex'));
  // input_tokens includes cached + cache-write tokens; we store the uncached part
  assert.deepEqual(
    events.map((e) => [e.input, e.cacheRead, e.cacheWrite, e.output]),
    [
      [10000, 40000, 0, 3000],
      [5000, 50000, 5000, 2000],
    ],
  );
});

test('codex (old format): per-turn last_token_usage, repeated emissions skipped, cumulative fallback', async () => {
  const events = await codex.parseFile(join(sessions, '2026/01/15/rollout-2026-01-15T09-00-00-0199-old.jsonl'));
  assert.equal(events.length, 3);
  assert.ok(events.every((e) => e.model === 'gpt-5'));
  // totals must equal the final cumulative total_token_usage (30000 in / 14000 cached / 1700 out)
  assert.equal(sum(events, 'input') + sum(events, 'cacheRead'), 30000);
  assert.equal(sum(events, 'cacheRead'), 14000);
  assert.equal(sum(events, 'output'), 1700);
});

test('codex: CODEX_HOME and period filter', async () => {
  const env = { TOKENRECEIPT_HOME: '/nonexistent', CODEX_HOME: join(fixture('home'), '.codex') };
  const all = await codex.load({ env });
  assert.equal(all.found, true);
  assert.equal(all.events.length, 5);
  const recent = await codex.load({ env: fixtureEnv(), sinceMs: Date.parse('2026-06-01') });
  assert.equal(recent.events.length, 2);
});
