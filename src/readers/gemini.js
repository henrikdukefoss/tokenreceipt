// Gemini CLI: <home>/.gemini/tmp/<project>/chats/session-*.jsonl (since 2026-04) or session-*.json (older).
// <home> is $GEMINI_CLI_HOME or the OS home; the macOS sandbox uses ~/.cache/.gemini instead.
// $GEMINI_DATA_DIR (as used by ccusage) points straight at the tmp directory.
//
// Message records: { id, timestamp, type: "gemini", model?, tokens: { input, output, cached, thoughts, tool, total } }
// The JSONL file is append-only and re-appends a message each time it changes, so the
// last line per id wins. Control lines ($set / $patch / $rewindTo) are ignored: rewound
// calls were still made. `input` includes `cached`; `thoughts` are billed as output and
// `tool` (tool-use prompt) as input. The model can be missing; the previous one is reused.
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { home, isDir, num, readJsonl, toMs, walk } from '../lib/fs.js';

export const id = 'gemini-cli';
export const name = 'Gemini CLI';

export function roots(env = process.env) {
  if (env.GEMINI_DATA_DIR) return [env.GEMINI_DATA_DIR];
  const h = env.GEMINI_CLI_HOME || home(env);
  return [join(h, '.gemini', 'tmp'), join(home(env), '.cache', '.gemini', 'tmp')];
}

export function toEvent(m, model) {
  const t = m?.tokens;
  if (!t || typeof t !== 'object') return null;
  const input = num(t.input);
  const cached = num(t.cached);
  const thoughts = num(t.thoughts);
  const tool = num(t.tool);
  const output = num(t.output);
  // promptTokenCount includes cached tokens when total adds up that way (it normally does)
  const inclusive = !t.total || num(t.total) === input + output + thoughts + tool;
  const ev = {
    agent: id,
    model: model || 'unknown',
    provider: 'gemini',
    ts: toMs(m.timestamp),
    input: (inclusive ? Math.max(0, input - cached) : input) + tool,
    output: output + thoughts,
    cacheRead: cached,
    cacheWrite: 0,
    cacheWrite1h: 0,
  };
  return ev.input + ev.output + ev.cacheRead > 0 ? ev : null;
}

async function messagesOf(file) {
  if (file.endsWith('.json')) {
    try {
      const doc = JSON.parse(readFileSync(file, 'utf8'));
      return Array.isArray(doc?.messages) ? doc.messages : [];
    } catch {
      return [];
    }
  }
  const byId = new Map();
  const order = [];
  for await (const line of readJsonl(file)) {
    if (!line || typeof line !== 'object' || !line.id || !line.type) continue; // metadata / control lines
    if (!byId.has(line.id)) order.push(line.id);
    byId.set(line.id, line);
  }
  return order.map((k) => byId.get(k));
}

export async function load({ sinceMs = 0, untilMs = Infinity, env } = {}) {
  const dirs = [...new Set(roots(env))].filter(isDir);
  if (!dirs.length) return { found: false };
  const files = dirs.flatMap((d) =>
    walk(d, (n) => n.endsWith('.json') || n.endsWith('.jsonl'), sinceMs).filter((f) => f.includes(`${sep}chats${sep}`)),
  );
  const seen = new Set();
  const events = [];
  for (const f of files) {
    let model;
    for (const m of await messagesOf(f)) {
      if (m?.type !== 'gemini') continue;
      if (m.model) model = m.model;
      const ev = toEvent(m, m.model || model);
      if (!ev || !(ev.ts >= sinceMs && ev.ts < untilMs)) continue;
      const key = m.id;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(ev);
    }
  }
  return { found: true, detail: `${files.length} chat file${files.length === 1 ? '' : 's'}`, events };
}
