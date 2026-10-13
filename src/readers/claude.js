// Claude Code: ~/.claude/projects/**/*.jsonl (and ~/.config/claude/projects)
// Assistant lines carry message.usage, message.model, message.id, requestId, timestamp.
// Streaming writes the same message several times; we keep one entry per
// message.id + requestId (the one with the most output tokens, i.e. the final count).
import { join } from 'node:path';
import { home, isDir, num, readJsonl, toMs, walk } from '../lib/fs.js';

export const id = 'claude-code';
export const name = 'Claude Code';

export function roots(env = process.env) {
  if (env.CLAUDE_CONFIG_DIR) {
    return env.CLAUDE_CONFIG_DIR.split(',').map((s) => s.trim()).filter(Boolean).map((d) => join(d, 'projects'));
  }
  return [join(home(env), '.config', 'claude', 'projects'), join(home(env), '.claude', 'projects')];
}

export async function load({ sinceMs = 0, untilMs = Infinity, env } = {}) {
  const dirs = [...new Set(roots(env))].filter(isDir);
  if (!dirs.length) return { found: false };
  const files = dirs.flatMap((d) => walk(d, (n) => n.endsWith('.jsonl'), sinceMs));
  const byKey = new Map();
  const loose = [];
  for (const file of files) {
    for await (const line of readJsonl(file, (l) => l.includes('"usage"'))) {
      const msg = line?.message;
      const u = msg?.usage;
      if (!u || typeof u !== 'object') continue;
      const model = msg.model;
      if (!model || model === '<synthetic>') continue;
      const ts = toMs(line.timestamp);
      if (!(ts >= sinceMs && ts < untilMs)) continue;
      const cacheWrite = num(u.cache_creation_input_tokens);
      const ev = {
        agent: id,
        model,
        ts,
        input: num(u.input_tokens),
        output: num(u.output_tokens),
        cacheRead: num(u.cache_read_input_tokens),
        cacheWrite,
        cacheWrite1h: Math.min(cacheWrite, num(u.cache_creation?.ephemeral_1h_input_tokens)),
      };
      if (msg.id) {
        // requestId is missing when Claude Code talks to a custom base URL; message.id still identifies the response
        const key = `${msg.id}:${line.requestId ?? ''}`;
        const prev = byKey.get(key);
        if (!prev || ev.output > prev.output) byKey.set(key, ev);
      } else {
        loose.push(ev);
      }
    }
  }
  return { found: true, detail: `${files.length} session file${files.length === 1 ? '' : 's'}`, events: [...byKey.values(), ...loose] };
}
