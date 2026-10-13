import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as gemini from '../src/readers/gemini.js';
import { fixture, fixtureEnv } from './helpers.js';

test('gemini: JSONL (last line per id wins, model carried forward) and legacy JSON sessions', async () => {
  const res = await gemini.load({ env: fixtureEnv() });
  assert.equal(res.found, true);
  assert.equal(res.events.length, 3);
  const [g1, g2] = res.events.filter((e) => e.model === 'gemini-2.5-pro').sort((a, b) => a.ts - b.ts);
  // input includes cached; thoughts are output; tool-use prompt is input
  assert.deepEqual([g1.input, g1.cacheRead, g1.output], [4000, 8000, 1000]);
  assert.deepEqual([g2.input, g2.cacheRead, g2.output], [5100, 10000, 500]);
  const old = res.events.find((e) => e.model === 'gemini-2.5-flash');
  assert.deepEqual([old.input, old.output], [3000, 150]);
});

test('gemini: GEMINI_CLI_HOME and period filter', async () => {
  const env = { TOKENRECEIPT_HOME: '/nonexistent', GEMINI_CLI_HOME: fixture('home') };
  assert.equal(gemini.roots(env)[0], join(fixture('home'), '.gemini', 'tmp'));
  const res = await gemini.load({ env, sinceMs: Date.parse('2026-06-01') });
  assert.equal(res.events.length, 2);
});
