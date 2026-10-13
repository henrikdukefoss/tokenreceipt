import { writeFileSync, readFileSync } from 'node:fs';
import { aggregate, parsePeriod } from './aggregate.js';
import { loadPrices } from './pricing.js';
import { agentNames, readAll, readers } from './readers/index.js';
import { THEMES, renderSvg } from './render/svg.js';
import { renderTerminal } from './render/terminal.js';
import { writePng } from './render/png.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `tokenreceipt ${VERSION} - a till receipt for your AI coding agents

Usage: npx tokenreceipt [options]

Options:
  --since <period>   7d | 30d | 90d | <n>d | all | YYYY-MM-DD   (default 30d)
  --svg <file>       also write a shareable receipt card (SVG)
  --png <file>       also write a PNG (uses rsvg-convert, resvg or Chrome if installed)
  --theme <name>     card theme: paper (default) or dark
  --json             print the data as JSON instead of the receipt
  --agent <ids>      only these agents, comma separated (${readers.map((r) => r.id).join(', ')})
  --offline          use the bundled price table (no network at all)
  --no-color         plain output
  -h, --help         show this help
  -v, --version      show version

Reads usage logs on this machine only. The only network request is the public
LiteLLM price list (cached 24h in ~/.cache/tokenreceipt). Logs are never uploaded.`;

export function parseArgs(argv) {
  const o = { since: '30d', json: false, offline: false, color: true, theme: 'paper' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v == null || v === '') throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--since': o.since = value(); break;
      case '--svg': o.svg = value(); break;
      case '--png': o.png = value(); break;
      case '--theme': o.theme = value(); break;
      case '--agent': case '--agents': o.agents = value().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--json': o.json = true; break;
      case '--offline': o.offline = true; break;
      case '--no-color': o.color = false; break;
      case '-h': case '--help': o.help = true; break;
      case '-v': case '--version': o.version = true; break;
      default: throw new Error(`unknown option ${a} (see --help)`);
    }
  }
  return o;
}

export async function main(argv = process.argv.slice(2)) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (err) {
    console.error(`tokenreceipt: ${err.message}`);
    return 2;
  }
  if (o.help) return console.log(HELP), 0;
  if (o.version) return console.log(VERSION), 0;

  let period;
  try {
    period = parsePeriod(o.since);
  } catch (err) {
    console.error(`tokenreceipt: ${err.message}`);
    return 2;
  }
  if (!THEMES[o.theme]) {
    console.error(`tokenreceipt: unknown theme "${o.theme}" (use ${Object.keys(THEMES).join(' or ')})`);
    return 2;
  }
  if (o.agents) {
    const unknown = o.agents.filter((a) => !readers.some((r) => r.id === a));
    if (unknown.length) {
      console.error(`tokenreceipt: unknown agent ${unknown.join(', ')} (known: ${readers.map((r) => r.id).join(', ')})`);
      return 2;
    }
  }

  const [scan, prices] = await Promise.all([readAll({ sinceMs: period.sinceMs, untilMs: period.untilMs }, o.agents), loadPrices({ offline: o.offline })]);
  const { agents, totals } = aggregate(scan.events, prices.table, agentNames);
  const report = { period, printedAt: new Date(), prices, agents, totals, version: VERSION };

  const log = (s) => console.error(s);
  const found = scan.found.map((f) => `${f.name} (${f.detail})`).join(', ');
  log(`found: ${found || 'none'}`);
  if (scan.missing.length) log(`not found: ${scan.missing.join(', ')}`);
  for (const w of scan.warnings) log(`note: ${w}`);
  if (prices.note) log(`note: ${prices.note}`);

  if (o.json) {
    console.log(JSON.stringify(toJson(report, scan), null, 2));
  } else {
    const color = o.color && process.stdout.isTTY && !process.env.NO_COLOR;
    process.stdout.write('\n' + renderTerminal(report, { color }) + '\n');
  }

  if (o.svg || o.png) {
    const svg = renderSvg(report, { theme: o.theme });
    if (o.svg) {
      writeFileSync(o.svg, svg);
      log(`wrote ${o.svg}`);
    }
    if (o.png) {
      try {
        const via = writePng(svg, o.png);
        log(`wrote ${o.png} (via ${via})`);
      } catch (err) {
        log(`tokenreceipt: could not write PNG: ${err.message}`);
        return 1;
      }
    }
  }
  if (!scan.found.length) log('\nNo supported agent logs found. Supported: ' + readers.map((r) => r.name).join(', '));
  return 0;
}

export function toJson(report, scan) {
  const { period, printedAt, prices, agents, totals } = report;
  return {
    period: { label: period.label, since: period.since?.toISOString() ?? null, until: period.until.toISOString() },
    generatedAt: printedAt.toISOString(),
    prices: { source: prices.source, fetchedAt: new Date(prices.fetchedAt).toISOString() },
    sources: { found: scan.found, missing: scan.missing },
    totals: { ...totals, cost: round(totals.cost) },
    agents: agents.map((a) => ({ ...a, cost: round(a.cost), models: a.models.map((m) => ({ ...m, cost: round(m.cost) })) })),
  };
}

const round = (n) => (n == null ? null : Math.round(n * 1e6) / 1e6);
