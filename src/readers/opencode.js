// OpenCode: $XDG_DATA_HOME/opencode (default ~/.local/share/opencode)
//   opencode.db            SQLite, table `message` (id, session_id, time_created, data JSON)
//   storage/message/<session>/<msg>.json   legacy one-file-per-message layout
// Assistant message JSON: { role:"assistant", modelID, providerID, time:{created},
//   tokens:{ input, output, reasoning, cache:{ read, write } }, cost }
// `input` excludes cache reads/writes; `reasoning` is reported separately from `output`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { home, isDir, isFile, num, toMs, walk } from '../lib/fs.js';
import { querySqlite } from '../lib/sqlite.js';

export const id = 'opencode';
export const name = 'OpenCode';

export function root(env = process.env) {
  return join(env.XDG_DATA_HOME || join(home(env), '.local', 'share'), 'opencode');
}

export function toEvent(m, fallbackId) {
  if (!m || m.role !== 'assistant' || !m.tokens) return null;
  const t = m.tokens;
  const ev = {
    agent: id,
    id: m.id || fallbackId,
    model: m.modelID || 'unknown',
    provider: m.providerID,
    ts: toMs(m.time?.created),
    input: num(t.input),
    output: num(t.output) + num(t.reasoning),
    cacheRead: num(t.cache?.read),
    cacheWrite: num(t.cache?.write),
    cacheWrite1h: 0,
  };
  return ev.input + ev.output + ev.cacheRead + ev.cacheWrite > 0 ? ev : null;
}

export async function load({ sinceMs = 0, untilMs = Infinity, env } = {}) {
  const dir = root(env);
  const db = join(dir, 'opencode.db');
  const legacy = join(dir, 'storage', 'message');
  const hasDb = isFile(db);
  const hasLegacy = isDir(legacy);
  if (!hasDb && !hasLegacy) return { found: false };

  const byId = new Map();
  const details = [];
  const warnings = [];
  const add = (ev) => {
    if (ev && ev.ts >= sinceMs && ev.ts < untilMs && !byId.has(ev.id)) byId.set(ev.id, ev);
  };

  if (hasDb) {
    const since = Number.isFinite(sinceMs) ? Math.floor(sinceMs) : 0;
    const { rows, error } = await querySqlite(db, `SELECT id, data FROM message WHERE time_created >= ${since}`);
    if (error) warnings.push(`OpenCode database skipped: ${error}`);
    else {
      details.push('opencode.db');
      for (const r of rows) {
        try {
          add(toEvent(JSON.parse(r.data), r.id));
        } catch {
          // malformed row
        }
      }
    }
  }
  if (hasLegacy) {
    const files = walk(legacy, (n) => n.endsWith('.json'), sinceMs);
    details.push(`${files.length} legacy message file${files.length === 1 ? '' : 's'}`);
    for (const f of files) {
      try {
        add(toEvent(JSON.parse(readFileSync(f, 'utf8')), f));
      } catch {
        // skip unreadable file
      }
    }
  }
  return { found: true, detail: details.join(' + ') || 'unreadable', events: [...byId.values()], warnings };
}
