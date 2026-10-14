// Pi coding agent: ${PI_CODING_AGENT_DIR:-~/.pi/agent}/sessions/<cwd slug>/<time>_<id>.jsonl
// ($PI_CODING_AGENT_SESSION_DIR overrides the sessions folder). Append-only JSONL entries
// { type, id, timestamp }. Usage is on:
//   type:"message" with message.role "assistant": message.{ provider, model, usage }
//   type:"usage" (e.g. cache warming): { provider, model, usage }
//   type:"compaction" / "branch_summary": usage without a model (last seen model is used)
// usage = { input, output, cacheRead, cacheWrite, cacheWrite1h? (subset of cacheWrite) }; input excludes cache,
// output includes reasoning. Forked sessions copy earlier entries with the same ids, so
// entries are deduped by id + timestamp across files.
import { join } from 'node:path';
import { home, isDir, num, readJsonl, toMs, walk } from '../lib/fs.js';

export const id = 'pi';
export const name = 'Pi';
// --project: the session header line records `cwd`.
export const projectAware = true;

export function roots(env = process.env) {
  if (env.PI_CODING_AGENT_SESSION_DIR) return [env.PI_CODING_AGENT_SESSION_DIR];
  return [join(env.PI_CODING_AGENT_DIR || join(home(env), '.pi', 'agent'), 'sessions')];
}

export async function load({ sinceMs = 0, untilMs = Infinity, env } = {}) {
  const dirs = roots(env).filter(isDir);
  if (!dirs.length) return { found: false };
  const files = dirs.flatMap((d) => walk(d, (n) => n.endsWith('.jsonl'), sinceMs)).filter((f) => !f.includes('subagent-artifacts'));
  const seen = new Set();
  const events = [];
  for (const f of files) {
    let model;
    let provider;
    let cwd;
    for await (const e of readJsonl(f, (l) => l.includes('"usage"') || l.includes('"model_change"') || l.includes('"cwd"'))) {
      if (e?.type === 'session') {
        if (typeof e.cwd === 'string' && e.cwd) cwd = e.cwd;
        continue;
      }
      if (e?.type === 'model_change') {
        model = e.modelId || model;
        provider = e.provider || provider;
        continue;
      }
      const src = e?.type === 'message' ? (e.message?.role === 'assistant' ? e.message : null) : e;
      const u = src?.usage;
      if (!u || typeof u !== 'object') continue;
      if (src.model) {
        model = src.model;
        provider = src.provider || provider;
      }
      const ts = toMs(e.timestamp ?? src.timestamp);
      if (!(ts >= sinceMs && ts < untilMs)) continue;
      const key = `${e.id}:${e.timestamp}`;
      if (e.id && seen.has(key)) continue;
      seen.add(key);
      const cacheWrite = num(u.cacheWrite); // cacheWrite1h is a subset of cacheWrite
      const ev = {
        agent: id,
        model: src.model || model || 'unknown',
        provider: src.provider || provider,
        ts,
        input: num(u.input),
        output: num(u.output),
        cacheRead: num(u.cacheRead),
        cacheWrite,
        cacheWrite1h: Math.min(cacheWrite, num(u.cacheWrite1h)),
        cwd,
      };
      if (ev.input + ev.output + ev.cacheRead + ev.cacheWrite > 0) events.push(ev);
    }
  }
  return { found: true, detail: `${files.length} session file${files.length === 1 ? '' : 's'}`, events };
}
