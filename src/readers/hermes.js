// Hermes agent: <HERMES_HOME>/state.db (default ~/.hermes, plus ~/.hermes/profiles/*/state.db).
// Hermes keeps running totals, not per-request records: session_model_usage has one row per
// session + model (+ helper task) with input/output/cache_read/cache_write tokens and
// api_call_count; older databases only have the per-session `sessions` totals.
// Rows are placed in time at last_seen / started_at (epoch seconds), so a period boundary
// can only split usage per session. Input excludes cache; reasoning is part of output.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { home, isFile, num } from '../lib/fs.js';
import { querySqlite } from '../lib/sqlite.js';

export const id = 'hermes';
export const name = 'Hermes';
// --project: not supported. state.db keeps per-session totals with no working directory.
export const projectAware = false;
export const projectNote = 'state.db records no working directory per session';

export function databases(env = process.env) {
  const base = env.HERMES_HOME || join(home(env), '.hermes');
  const dbs = [join(base, 'state.db')];
  try {
    for (const p of readdirSync(join(base, 'profiles'))) dbs.push(join(base, 'profiles', p, 'state.db'));
  } catch {
    // no profiles
  }
  return dbs.filter(isFile);
}

const toEvent = (r, ts) => ({
  agent: id,
  model: r.model || 'unknown',
  provider: r.billing_provider || undefined,
  ts: num(ts) * 1000,
  requests: num(r.api_call_count) || 1,
  input: num(r.input_tokens),
  output: num(r.output_tokens),
  cacheRead: num(r.cache_read_tokens),
  cacheWrite: num(r.cache_write_tokens),
  cacheWrite1h: 0,
});

export async function load({ sinceMs = 0, untilMs = Infinity, env } = {}) {
  const dbs = databases(env);
  if (!dbs.length) return { found: false };
  const events = [];
  const warnings = [];
  for (const db of dbs) {
    let { rows, error } = await querySqlite(db, 'SELECT model, billing_provider, api_call_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, first_seen, last_seen FROM session_model_usage');
    if (!error) {
      for (const r of rows) events.push(toEvent(r, r.last_seen || r.first_seen));
      continue;
    }
    ({ rows, error } = await querySqlite(db, 'SELECT model, billing_provider, api_call_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, started_at FROM sessions WHERE model IS NOT NULL'));
    if (error) warnings.push(`Hermes database skipped: ${error}`);
    else for (const r of rows) events.push(toEvent(r, r.started_at));
  }
  const inPeriod = events.filter((e) => e.ts >= sinceMs && e.ts < untilMs && e.input + e.output + e.cacheRead + e.cacheWrite > 0);
  return { found: true, detail: `${dbs.length} database${dbs.length === 1 ? '' : 's'}`, events: inPeriod, warnings };
}
