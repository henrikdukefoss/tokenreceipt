import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePeriod } from '../src/aggregate.js';
import { BADGE_LINK, buildBadge, shieldsEscape, shieldsUrl } from '../src/badge.js';
import { parseArgs } from '../src/cli.js';
import { fixture } from './helpers.js';

const now = Date.parse('2026-10-13T12:00:00Z');
const report = (totals, since = '30d') => ({ period: parsePeriod(since, now), totals: { tokens: 0, cost: 0, unpricedTokens: 0, ...totals } });

test('shieldsEscape doubles dashes and underscores, then URL-encodes', () => {
  assert.equal(shieldsEscape('built with'), 'built%20with');
  assert.equal(shieldsEscape('gpt-5_mini'), 'gpt--5__mini');
  assert.equal(shieldsEscape('$1,234.50+'), '%241%2C234.50%2B');
  assert.equal(shieldsEscape('a/b?c#d&e'), 'a%2Fb%3Fc%23d%26e');
  assert.equal(shieldsUrl('built with', '1.2M tokens'), 'https://img.shields.io/badge/built%20with-1.2M%20tokens-1d2434');
});

test('badge shows tokens only by default and links to the repo', () => {
  const b = buildBadge(report({ tokens: 121_494_391, cost: 113.16 }));
  assert.equal(b.message, '121.5M tokens');
  assert.equal(b.url, 'https://img.shields.io/badge/built%20with-121.5M%20tokens-1d2434');
  assert.equal(b.markdown, `[![Built with 121.5M tokens](${b.url} "Counted by tokenreceipt from local agent logs, last 30 days")](${BADGE_LINK})`);
  assert.doesNotMatch(b.markdown, /\$/);
});

test('badge cost is opt-in, list price, and a lower bound when some tokens are unpriced', () => {
  const b = buildBadge(report({ tokens: 2_500_000, cost: 1234.5 }, 'all'), { cost: true });
  assert.equal(b.message, '2.5M tokens, $1,234.50 at API list price');
  assert.match(b.url, /-2.5M%20tokens%2C%20%241%2C234.50%20at%20API%20list%20price-/);
  assert.match(b.markdown, /"Counted by tokenreceipt from all available local agent logs"/);
  assert.deepEqual(b.notes, []);

  const partial = buildBadge(report({ tokens: 3000, cost: 0.5, unpricedTokens: 1000 }), { cost: true });
  assert.equal(partial.message, '3.0K tokens, $0.50+ at API list price');
  assert.match(partial.url, /%240.50%2B/);
  assert.equal(partial.notes.length, 1);

  const unpriced = buildBadge(report({ tokens: 3000, cost: 0, unpricedTokens: 3000 }), { cost: true });
  assert.equal(unpriced.message, '3.0K tokens');
  assert.equal(unpriced.notes.length, 1);
});

test('badge hover title says "this project" with --project', () => {
  const b = buildBadge({ ...report({ tokens: 11_220 }), project: '/work/alpha' });
  assert.match(b.markdown, /"Counted by tokenreceipt for this project from local agent logs, last 30 days"/);
});

test('no usage, no badge', () => {
  assert.equal(buildBadge(report({ tokens: 0 })), null);
});

test('parseArgs: --badge and --badge-cost', () => {
  assert.equal(parseArgs(['--badge']).badge, true);
  assert.equal(parseArgs(['--badge']).badgeCost, undefined);
  assert.deepEqual([parseArgs(['--badge-cost']).badge, parseArgs(['--badge-cost']).badgeCost], [true, true]);
});

const bin = fileURLToPath(new URL('../bin/tokenreceipt.js', import.meta.url));
const runIn = (args, home = fixture('sample-home')) =>
  execFileSync(process.execPath, [bin, ...args], {
    env: { PATH: process.env.PATH, TOKENRECEIPT_HOME: home, XDG_CACHE_HOME: join(tmpdir(), 'tokenreceipt-test-cache'), NO_COLOR: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

test('cli: --badge prints one Markdown line for the sample fixtures and respects --agent', () => {
  // --all-projects: the tests run inside this git repo, where --badge would default to --project .
  const run = (args, home) => runIn([...args, '--all-projects'], home);
  const out = run(['--since', 'all', '--offline', '--badge']);
  assert.equal(out, `[![Built with 121.5M tokens](https://img.shields.io/badge/built%20with-121.5M%20tokens-1d2434 "Counted by tokenreceipt from all available local agent logs")](${BADGE_LINK})\n`);
  const cost = run(['--since', 'all', '--offline', '--badge-cost']);
  assert.match(cost, /built%20with-121.5M%20tokens%2C%20%24113.16%20at%20API%20list%20price-1d2434/);
  const codex = run(['--since', 'all', '--offline', '--badge', '--agent', 'codex']);
  assert.match(codex, /built%20with-19.4M%20tokens-/);
  assert.equal(run(['--offline', '--badge'], '/nonexistent'), '');
  assert.throws(() => run(['--offline', '--badge', '--json']), (e) => e.status === 2);
});
