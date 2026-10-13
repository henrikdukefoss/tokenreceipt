import { VENDOR_PREFIX, findPrice, priceEvent } from './pricing.js';

/**
 * Display/grouping name: drops a vendor prefix and a trailing release date
 * (anthropic/claude-haiku-4-5-20251001 -> claude-haiku-4-5). Pricing still uses the raw id.
 */
export function displayModel(m) {
  let s = String(m);
  while (VENDOR_PREFIX.test(s)) s = s.replace(VENDOR_PREFIX, '');
  return s.replace(/[-@]\d{8}$/, '') || String(m);
}

const tokensOf = (e) => e.input + e.output + e.cacheRead + e.cacheWrite;
const byCostThenTokens = (a, b) => (b.cost ?? -1) - (a.cost ?? -1) || b.tokens - a.tokens;

/** Parse --since: 7d | 30d | 90d | <n>d | all | YYYY-MM-DD */
export function parsePeriod(since = '30d', now = Date.now()) {
  const s = String(since).trim().toLowerCase();
  if (s === 'all') return { sinceMs: 0, untilMs: Infinity, label: 'ALL TIME', since: null, until: new Date(now) };
  let m = /^(\d+)d$/.exec(s);
  if (m && +m[1] > 0) {
    const sinceMs = now - +m[1] * 86400000;
    return { sinceMs, untilMs: Infinity, label: `LAST ${m[1]} DAY${m[1] === '1' ? '' : 'S'}`, since: new Date(sinceMs), until: new Date(now) };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (!Number.isNaN(d.getTime())) return { sinceMs: d.getTime(), untilMs: Infinity, label: `SINCE ${s}`, since: d, until: new Date(now) };
  }
  throw new Error(`invalid --since "${since}" (use 7d, 30d, 90d, <n>d, all, or YYYY-MM-DD)`);
}

export function aggregate(events, priceTable, agentNames = {}) {
  const agents = new Map();
  const priceCache = new Map();
  for (const e of events) {
    const pk = `${e.model}\u0000${e.provider || ''}`;
    if (!priceCache.has(pk)) priceCache.set(pk, findPrice(priceTable, e.model, e.provider));
    const price = priceCache.get(pk);
    let a = agents.get(e.agent);
    if (!a) agents.set(e.agent, (a = { id: e.agent, name: agentNames[e.agent] || e.agent, models: new Map() }));
    const name = displayModel(e.model);
    let m = a.models.get(name);
    if (!m) {
      a.models.set(name, (m = { model: name, priced: !!price, priceKey: price?.key ?? null, requests: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: price ? 0 : null }));
    }
    if (price && !m.priced) Object.assign(m, { priced: true, priceKey: price.key, cost: 0 });
    m.requests += e.requests ?? 1;
    m.tokens += tokensOf(e);
    m.input += e.input;
    m.output += e.output;
    m.cacheRead += e.cacheRead;
    m.cacheWrite += e.cacheWrite;
    if (price) m.cost += priceEvent(price, e);
  }
  const sum = (list, k) => list.reduce((s, x) => s + (x[k] || 0), 0);
  const out = [...agents.values()].map((a) => {
    const models = [...a.models.values()].sort(byCostThenTokens);
    const priced = models.filter((m) => m.priced);
    return {
      id: a.id,
      name: a.name,
      requests: sum(models, 'requests'),
      tokens: sum(models, 'tokens'),
      input: sum(models, 'input'),
      output: sum(models, 'output'),
      cacheRead: sum(models, 'cacheRead'),
      cacheWrite: sum(models, 'cacheWrite'),
      cost: priced.length ? sum(priced, 'cost') : null,
      unpricedTokens: sum(models.filter((m) => !m.priced), 'tokens'),
      models,
    };
  });
  out.sort(byCostThenTokens);
  const priced = out.filter((a) => a.cost != null);
  return {
    agents: out,
    totals: {
      requests: sum(out, 'requests'),
      tokens: sum(out, 'tokens'),
      input: sum(out, 'input'),
      output: sum(out, 'output'),
      cacheRead: sum(out, 'cacheRead'),
      cacheWrite: sum(out, 'cacheWrite'),
      cost: sum(priced, 'cost'),
      unpricedTokens: sum(out, 'unpricedTokens'),
    },
  };
}
