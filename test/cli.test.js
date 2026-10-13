import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate, parsePeriod } from '../src/aggregate.js';
import { parseArgs } from '../src/cli.js';
import { fixture, offlinePrices } from './helpers.js';

const bin = fileURLToPath(new URL('../bin/tokenreceipt.js', import.meta.url));

function run(args, extraEnv = {}) {
  const env = { PATH: process.env.PATH, TOKENRECEIPT_HOME: fixture('home'), XDG_CACHE_HOME: join(tmpdir(), 'tokenreceipt-test-cache'), NO_COLOR: '1', ...extraEnv };
  return execFileSync(process.execPath, [bin, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('parsePeriod', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  assert.equal(parsePeriod('7d', now).sinceMs, now - 7 * 86400000);
  assert.equal(parsePeriod('all', now).sinceMs, 0);
  assert.equal(parsePeriod('90d', now).label, 'LAST 90 DAYS');
  assert.throws(() => parsePeriod('lastweek', now));
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['--since=7d', '--svg', 'r.svg', '--json', '--offline', '--agent', 'codex,claude-code']), {
    since: '7d',
    svg: 'r.svg',
    json: true,
    offline: true,
    color: true,
    theme: 'paper',
    agents: ['codex', 'claude-code'],
  });
  assert.throws(() => parseArgs(['--nope']));
  assert.throws(() => parseArgs(['--svg']));
});

test('aggregate groups dated model ids and keeps gateways unpriced', () => {
  const ev = (model, o = {}) => ({ agent: 'x', model, ts: 0, input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, ...o });
  const { agents, totals } = aggregate([ev('claude-haiku-4-5-20251001'), ev('anthropic/claude-haiku-4-5'), ev('standardcompute')], offlinePrices(), { x: 'X' });
  assert.deepEqual(agents[0].models.map((m) => [m.model, m.requests, m.priced]), [
    ['claude-haiku-4-5', 2, true],
    ['standardcompute', 1, false],
  ]);
  assert.equal(totals.unpricedTokens, 2000);
  assert.equal(agents[0].models[1].cost, null);
});

test('cli: --json over the fixture home, offline', () => {
  const out = JSON.parse(run(['--since', 'all', '--json', '--offline']));
  const ids = out.sources.found.map((f) => f.id);
  for (const a of ['claude-code', 'codex', 'opencode', 'gemini-cli', 'cline', 'pi']) assert.ok(ids.includes(a), a);
  const claude = out.agents.find((a) => a.id === 'claude-code');
  assert.equal(claude.requests, 5);
  assert.ok(claude.cost > 0);
  const oc = out.agents.find((a) => a.id === 'opencode');
  assert.equal(oc.models.find((m) => m.model === 'standardcompute').cost, null);
  assert.equal(out.prices.source, 'LiteLLM (bundled)');
  assert.ok(out.totals.cost > 0);
});

test('cli: receipt text and SVG card', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenreceipt-svg-'));
  try {
    const svgPath = join(dir, 'r.svg');
    const text = run(['--since', 'all', '--offline', '--svg', svgPath]);
    assert.match(text, /T O K E N {3}R E C E I P T/);
    assert.match(text, /TOTAL AT API LIST PRICE +\$\d/);
    assert.match(text, /Thank you for burning/);
    assert.match(text, /STANDARDCOMPUTE\.COM/);
    assert.match(text, /standardcompute \.+ +\S+ +unpriced/);
    assert.doesNotMatch(text, /\u2014/); // no em dashes
    const svg = readFileSync(svgPath, 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /TOTAL AT API LIST PRICE/);
    assert.match(svg, /MADE BY STANDARD COMPUTE/);
    assert.doesNotMatch(svg, /unlimited|sav(e|ing)/i);
    assert.equal((svg.match(/<text/g) || []).length, (svg.match(/<\/text>/g) || []).length);
    assert.doesNotMatch(svg, /Gradient/);
    run(['--since', 'all', '--offline', '--svg', svgPath, '--theme', 'dark']);
    assert.match(readFileSync(svgPath, 'utf8'), /#141926/);
    assert.throws(() => run(['--offline', '--theme', 'neon']), (e) => e.status === 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: no logs found is not an error', () => {
  const out = run(['--offline'], { TOKENRECEIPT_HOME: '/nonexistent' });
  assert.match(out, /NO AGENT USAGE FOUND/);
});

test('cli: bad flag exits 2', () => {
  assert.throws(() => run(['--since', 'yesterday']), (e) => e.status === 2);
});

test('--since all receipts say they cover all available local logs', async () => {
  const { buildLines } = await import('../src/render/receipt.js');
  const text = (lines) => lines.map((l) => (l.segs || []).map((s) => s.text ?? s).join('')).join('\n');
  const base = { agents: [], totals: { tokens: 0, cost: 0, requests: 0, cacheRead: 0, unpricedTokens: 0 }, printedAt: new Date('2026-10-13T12:00:00Z'), prices: { source: 'bundled', date: '2026-10-01' }, version: '0.1.0' };
  const all = text(buildLines({ ...base, period: parsePeriod('all', Date.parse('2026-10-13T12:00:00Z')) }));
  assert.match(all, /SCOPE\s+ALL AVAILABLE LOCAL LOGS/);
  const month = text(buildLines({ ...base, period: parsePeriod('30d', Date.parse('2026-10-13T12:00:00Z')) }));
  assert.doesNotMatch(month, /ALL AVAILABLE LOCAL LOGS/);
});
