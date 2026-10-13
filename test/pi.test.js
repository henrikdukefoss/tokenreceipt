import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pi from '../src/readers/pi.js';
import { fixtureEnv } from './helpers.js';

test('pi: assistant messages, usage and compaction entries; forked copies deduped', async () => {
  const res = await pi.load({ env: fixtureEnv() });
  assert.equal(res.found, true);
  assert.deepEqual(
    res.events.map((e) => [e.model, e.input, e.output, e.cacheRead, e.cacheWrite, e.cacheWrite1h]),
    [
      ['claude-sonnet-4-5', 40, 900, 30000, 4000, 1000],
      ['claude-sonnet-4-5', 1, 1, 34000, 0, 0],
      ['claude-sonnet-4-5', 30000, 800, 0, 0, 0],
      ['gpt-5', 2000, 300, 0, 0, 0],
    ],
  );
});

test('pi: PI_CODING_AGENT_DIR override', async () => {
  const res = await pi.load({ env: { TOKENRECEIPT_HOME: '/nonexistent', PI_CODING_AGENT_DIR: '/also-nonexistent' } });
  assert.equal(res.found, false);
});
