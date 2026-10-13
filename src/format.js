export function compact(n) {
  const abs = Math.abs(n);
  const fmt = (v, s) => `${v.toFixed(1)}${s}`; // one decimal everywhere so columns line up
  if (abs >= 1e12) return fmt(n / 1e12, 'T');
  if (abs >= 1e9) return fmt(n / 1e9, 'B');
  if (abs >= 1e6) return fmt(n / 1e6, 'M');
  if (abs >= 1e3) return fmt(n / 1e3, 'K');
  return String(Math.round(n));
}

export const grouped = (n) => Math.round(n).toLocaleString('en-US');

export function usd(n) {
  if (n == null) return 'unpriced';
  if (n > 0 && n < 0.01) return '<$0.01';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ymd(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function hm(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Model rows keep at most `max` entries per agent; the rest fold into "other models". */
export function foldModels(models, max) {
  if (models.length <= max) return models;
  const head = models.slice(0, max - 1);
  const rest = models.slice(max - 1);
  const pricedRest = rest.filter((m) => m.priced);
  return [
    ...head,
    {
      model: `${rest.length} other models`,
      tokens: rest.reduce((s, m) => s + m.tokens, 0),
      cost: pricedRest.length ? pricedRest.reduce((s, m) => s + m.cost, 0) : null,
      priced: pricedRest.length > 0,
      partial: pricedRest.length > 0 && pricedRest.length < rest.length,
    },
  ];
}
