// Codex CLI: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl (default ~/.codex)
//
// Newer files: {"type":"token_usage_record","payload":{"response_id",...,"usage":{...}}}
//   one line per model response; `usage` is per response (turn/thread totals are cumulative).
// Older files: {"type":"event_msg","payload":{"type":"token_count","info":{last_token_usage,total_token_usage}}}
//   the same event is often emitted twice (rate-limit refreshes), so an event whose
//   cumulative total did not change is skipped.
// When a file has token_usage_record lines, only those are used (the file also has
// token_count events for the same responses).
//
// OpenAI semantics: input_tokens includes cached_input_tokens (and cache_write_input_tokens);
// output_tokens includes reasoning_output_tokens.
import { join } from 'node:path';
import { home, isDir, num, readJsonl, toMs, walk } from '../lib/fs.js';

export const id = 'codex';
export const name = 'Codex CLI';

export function roots(env = process.env) {
  const base = env.CODEX_HOME || join(home(env), '.codex');
  return [join(base, 'sessions'), join(base, 'archived_sessions')];
}

function toEvent(u, model, ts) {
  const cacheRead = num(u.cached_input_tokens);
  const cacheWrite = num(u.cache_write_input_tokens);
  return {
    agent: id,
    model,
    ts,
    input: Math.max(0, num(u.input_tokens) - cacheRead - cacheWrite),
    output: num(u.output_tokens),
    cacheRead,
    cacheWrite,
    cacheWrite1h: 0,
  };
}

const sub = (a = {}, b = {}) => {
  const out = {};
  for (const k of ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens']) {
    out[k] = Math.max(0, num(a[k]) - num(b[k]));
  }
  return out;
};

const relevant = (l) =>
  l.includes('"token_usage_record"') || l.includes('"token_count"') || l.includes('"turn_context"') || l.includes('"session_meta"');

export async function parseFile(file, { sinceMs = 0, untilMs = Infinity, seen = new Set() } = {}) {
  const records = [];
  const counts = [];
  const turnModel = new Map();
  let model = 'unknown';
  let prevTotal = null;
  let prevTotalObj = null;
  for await (const line of readJsonl(file, relevant)) {
    const p = line?.payload;
    if (!p || typeof p !== 'object') continue;
    const ts = toMs(line.timestamp);
    if (line.type === 'session_meta' || line.type === 'turn_context') {
      if (typeof p.model === 'string' && p.model) {
        model = p.model;
        if (p.turn_id) turnModel.set(p.turn_id, p.model);
      }
      continue;
    }
    if (line.type === 'token_usage_record' && p.usage) {
      if (p.response_id) {
        if (seen.has(p.response_id)) continue;
        seen.add(p.response_id);
      }
      records.push(toEvent(p.usage, turnModel.get(p.turn_id) || model, ts));
      continue;
    }
    if (line.type === 'event_msg' && p.type === 'token_count' && p.info) {
      const total = p.info.total_token_usage;
      const totalN = total ? num(total.total_tokens) : null;
      if (totalN != null && totalN === prevTotal) continue; // repeated emission
      let last = p.info.last_token_usage;
      if (!last && total) last = prevTotalObj && totalN >= prevTotal ? sub(total, prevTotalObj) : total;
      if (total) {
        prevTotal = totalN;
        prevTotalObj = total;
      }
      if (last) counts.push(toEvent(last, model, ts));
    }
  }
  const events = (records.length ? records : counts).filter((e) => e.ts >= sinceMs && e.ts < untilMs);
  return events;
}

export async function load({ sinceMs = 0, untilMs = Infinity, env } = {}) {
  const dirs = roots(env).filter(isDir);
  if (!dirs.length) return { found: false };
  const files = dirs.flatMap((d) => walk(d, (n) => n.endsWith('.jsonl'), sinceMs));
  const seen = new Set();
  const events = [];
  for (const f of files) events.push(...(await parseFile(f, { sinceMs, untilMs, seen })));
  return { found: true, detail: `${files.length} session file${files.length === 1 ? '' : 's'}`, events };
}
