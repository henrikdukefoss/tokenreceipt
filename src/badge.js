// "Built with N tokens" README badge: a static shields.io URL wrapped in Markdown.
// Nothing is sent anywhere by tokenreceipt; the numbers live in the URL that is printed.
import { compact, usd } from './format.js';

export const BADGE_LINK = 'https://github.com/henrikdukefoss/tokenreceipt';
export const BADGE_COLOR = '1d2434'; // navy from the dark receipt theme

/** Escape one static-badge field: shields.io reads "-" and "_" as separators/spaces, so double them, then URL-encode. */
export function shieldsEscape(s) {
  return encodeURIComponent(String(s).replace(/-/g, '--').replace(/_/g, '__'));
}

export function shieldsUrl(label, message, color = BADGE_COLOR) {
  return `https://img.shields.io/badge/${shieldsEscape(label)}-${shieldsEscape(message)}-${shieldsEscape(color)}`;
}

/**
 * Returns { markdown, url, label, message, notes } for the report totals, or null when there is no usage.
 * The token count is always shown; the list-price cost only with { cost: true }.
 */
export function buildBadge(report, { cost = false } = {}) {
  const { totals, period } = report;
  if (!totals.tokens) return null;
  const notes = [];
  const label = 'built with';
  let message = `${compact(totals.tokens)} tokens`;
  if (cost) {
    const priced = totals.tokens - (totals.unpricedTokens || 0);
    if (!priced || !(totals.cost > 0)) {
      notes.push('no priced usage in this period, so the badge shows tokens only');
    } else {
      const partial = totals.unpricedTokens > 0;
      message += `, ${usd(totals.cost)}${partial ? '+' : ''} at API list price`;
      if (partial) notes.push(`${compact(totals.unpricedTokens)} tokens have no list price; "+" marks the cost as a lower bound`);
    }
  }
  const url = shieldsUrl(label, message);
  const scope = period.sinceMs === 0 ? 'from all available local agent logs' : `from local agent logs, ${period.label.toLowerCase()}`;
  const alt = `Built with ${message}`.replace(/[[\]]/g, '');
  const title = `Counted by tokenreceipt ${scope}`.replace(/"/g, "'");
  return { markdown: `[![${alt}](${url} "${title}")](${BADGE_LINK})`, url, label, message, notes };
}
