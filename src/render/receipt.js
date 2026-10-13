// Lays the receipt out on a fixed character grid, the way a POS thermal printer does.
// Both renderers consume the same lines, so the terminal and the card always match.
//
// A line is { segs: [{ text, tone }], size?: 'tall' } where tone is
// 'ink' | 'bold' | 'faint' | 'accent'. A thermal printer has one ink, so hierarchy comes from
// bold, double-size print and indentation; 'faint' is used once, 'accent' only for the total.
// Every line is exactly WIDTH characters. Special lines: { barcode: text } and { blank: true }.
import { compact, foldModels, grouped, hm, usd, ymd } from '../format.js';

export const WIDTH = 42;
const TOK_W = 6; // tokens column
const AMT_W = 10; // amount column
const MAX_MODELS_PER_AGENT = 5;

export const FOOTER_LINES = ['TOKENRECEIPT, OPEN SOURCE', 'MADE BY STANDARD COMPUTE', 'FLAT MONTHLY PLANS FOR AGENT WORKLOADS', 'STANDARDCOMPUTE.COM'];

const seg = (text, tone = 'ink') => ({ text, tone });
const blank = () => ({ blank: true });

function center(text, tone = 'ink', w = WIDTH) {
  text = text.length > w ? text.slice(0, w) : text;
  const left = Math.floor((w - text.length) / 2);
  return { segs: [seg(' '.repeat(left)), seg(text, tone), seg(' '.repeat(w - left - text.length))] };
}

function rule(ch = '-') {
  return { segs: [seg(ch.repeat(WIDTH))] };
}

/** left .......... right */
function leader(left, right, { tone = 'ink', rightTone = tone, dots = true } = {}) {
  const room = WIDTH - right.length;
  if (left.length > room - 2) left = left.slice(0, room - 3) + '…';
  const gap = room - left.length;
  const fill = dots && gap >= 4 ? ' ' + '.'.repeat(gap - 2) + ' ' : ' '.repeat(gap);
  return { segs: [seg(left, tone), seg(fill, tone === 'bold' ? 'ink' : tone), seg(right, rightTone)] };
}

function item(name, tokens, amount, { tone = 'ink', indent = false, amountTone } = {}) {
  const right = tokens.padStart(TOK_W) + ' ' + amount.padStart(AMT_W);
  const line = leader((indent ? '  ' : '') + name, right, { tone });
  if (amountTone) {
    // recolor just the amount
    const r = line.segs.pop();
    line.segs.push(seg(r.text.slice(0, r.text.length - amount.length), tone), seg(amount, amountTone));
  }
  return line;
}

const plain = (n) => (n == null ? 'unpriced' : n > 0 && n < 0.01 ? '<0.01' : usd(n).slice(1)); // item amounts print without "$"

/** Short, stable receipt number derived from the period and the totals. */
export function receiptNumber(report) {
  const { period, totals } = report;
  const key = `${period.since ? ymd(period.since) : 'all'}|${ymd(period.until)}|${totals.tokens}|${Math.round(totals.cost * 100)}`;
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16).toUpperCase().padStart(8, '0');
}

// Code 39 patterns (bar, space, bar, ... ; 1 = wide) for the characters a receipt number uses.
const CODE39 = {
  0: '000110100', 1: '100100001', 2: '001100001', 3: '101100000', 4: '000110001',
  5: '100110000', 6: '001110000', 7: '000100101', 8: '100100100', 9: '001100100',
  A: '100001001', B: '001001001', C: '101001000', D: '000011001', E: '100011000',
  F: '001011000', '*': '010010100',
};

/** Code 39 element widths in narrow units (wide = 3), with a 1-unit gap between characters. */
export function code39(text, wide = 3) {
  const out = [];
  [...`*${text}*`].forEach((ch, i) => {
    if (i) out.push(1); // inter-character gap (a space)
    for (const w of CODE39[ch]) out.push(w === '1' ? wide : 1);
  });
  return out; // alternates bar, space, bar, ... starting and ending with a bar
}

export function buildLines(report) {
  const { agents, totals, period, printedAt, prices } = report;
  const rcpt = receiptNumber(report);
  const L = [];

  L.push({ ...center('TOKEN RECEIPT', 'bold', WIDTH / 2), size: 'wide' });
  L.push(center('LOCAL AGENT USAGE AT API LIST PRICES'));
  L.push(blank());
  L.push(leader(`${ymd(printedAt)} ${hm(printedAt)}`, `RCPT ${rcpt}`, { dots: false }));
  L.push(leader('CASHIER', `TOKENRECEIPT ${report.version || ''}`.trim(), { dots: false }));
  const days = period.since ? Math.round((period.until - period.since) / 86400000) : null;
  L.push(leader('PERIOD', period.since ? `${ymd(period.since)} TO ${ymd(period.until).slice(5)} (${days}D)` : `ALL TIME TO ${ymd(period.until)}`, { dots: false }));
  L.push(rule());
  L.push({ segs: [seg('ITEM'.padEnd(WIDTH - TOK_W - AMT_W - 1)), seg('TOKENS'.padStart(TOK_W)), seg(' '), seg('USD'.padStart(AMT_W))] });

  if (!agents.length) {
    L.push(blank());
    L.push(center('NO AGENT USAGE FOUND'));
  }
  for (const a of agents) {
    L.push(blank());
    // a single-model agent would repeat its numbers on the model row, so its header is the name only
    if (a.models.length === 1) L.push({ segs: [seg(a.name.toUpperCase().padEnd(WIDTH), 'bold')] });
    else L.push(item(a.name.toUpperCase(), compact(a.tokens), plain(a.cost), { tone: 'bold' }));
    for (const m of foldModels(a.models, MAX_MODELS_PER_AGENT)) {
      L.push(item(m.model, compact(m.tokens), m.priced ? plain(m.cost) + (m.partial ? '*' : '') : 'unpriced', { indent: true }));
    }
  }
  // no SUBTOTAL: with nothing between it and the TOTAL it only repeated the same number
  if (totals.unpricedTokens > 0) {
    L.push(rule());
    L.push(leader('UNPRICED TOKENS', compact(totals.unpricedTokens)));
  }
  L.push(rule('='));
  L.push({ ...leader('TOTAL AT API LIST PRICE', usd(totals.cost), { tone: 'bold', rightTone: 'accent', dots: false }), size: 'tall' });
  L.push(rule('='));
  L.push(leader('REQUESTS', grouped(totals.requests)));
  L.push(leader('TOKENS', grouped(totals.tokens)));
  L.push(leader('  CACHE READS', grouped(totals.cacheRead), { tone: 'faint' }));
  L.push(rule());
  L.push(blank());
  L.push(center(totals.tokens ? `Thank you for burning ${compact(totals.tokens)} tokens` : 'Thank you for visiting', 'bold'));
  L.push(blank());
  L.push({ barcode: rcpt });
  L.push(center(`*${rcpt}*`));
  L.push(blank());
  L.push(center(`PRICES: ${prices.source.toUpperCase()} ${ymd(new Date(prices.fetchedAt))}`));
  if (L.some((l) => l.segs?.some((s) => s.text.endsWith('*') && !s.text.startsWith('*')))) L.push(center('* INCLUDES UNPRICED MODELS'));
  L.push(blank());
  for (const f of FOOTER_LINES) L.push(center(f));
  return L;
}
