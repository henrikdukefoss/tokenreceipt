#!/usr/bin/env node
// Renders docs/sample-receipt.svg (+ .png when a converter is installed) and
// docs/sample-output.txt from the synthetic fixture home in test/fixtures/sample-home.
// Deterministic: fixed clock and the bundled price snapshot. Never reads real logs.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aggregate, parsePeriod } from '../src/aggregate.js';
import { loadPrices } from '../src/pricing.js';
import { agentNames, readAll } from '../src/readers/index.js';
import { writePng } from '../src/render/png.js';
import { renderSvg } from '../src/render/svg.js';
import { renderTerminal } from '../src/render/terminal.js';

const home = fileURLToPath(new URL('../test/fixtures/sample-home', import.meta.url));
const env = { TOKENRECEIPT_HOME: home };
const now = Date.parse('2026-10-01T09:41:00');
const period = parsePeriod('30d', now);

const scan = await readAll({ sinceMs: period.sinceMs, untilMs: period.untilMs, env });
const prices = await loadPrices({ offline: true });
prices.fetchedAt = now;
const { agents, totals } = aggregate(scan.events, prices.table, agentNames);
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const report = { period, printedAt: new Date(now), prices, agents, totals, version };

const docs = (f) => fileURLToPath(new URL(`../docs/${f}`, import.meta.url));
writeFileSync(docs('sample-output.txt'), renderTerminal(report));
for (const [theme, name] of [['paper', 'sample-receipt'], ['dark', 'sample-receipt-dark']]) {
  const svg = renderSvg(report, { theme });
  writeFileSync(docs(`${name}.svg`), svg);
  try {
    writePng(svg, docs(`${name}.png`));
  } catch (err) {
    console.error(`png skipped: ${err.message}`);
  }
}
console.log(`found: ${scan.found.map((f) => f.name).join(', ')}`);
console.log(renderTerminal(report));
