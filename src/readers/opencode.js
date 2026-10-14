// OpenCode: $XDG_DATA_HOME/opencode (default ~/.local/share/opencode)
//   opencode.db            SQLite, table `message` (id, session_id, time_created, data JSON)
//   storage/message/<session>/<msg>.json   legacy one-file-per-message layout
// Assistant message JSON: { role:"assistant", modelID, providerID, time:{created},
//   tokens:{ input, output, reasoning, cache:{ read, write } }, cost, path:{ cwd, root } }
// Sessions: table `session` (id, directory) or legacy storage/session/<project>/<session>.json.
// `input` excludes cache reads/writes; `reasoning` is reported separately from `output`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { home, isDir, isFile, num, toMs, walk } from '../lib/fs.js';
import { querySqlite } from '../lib/sqlite.js';

export const id = 'opencode';
export const name = 'OpenCode';
// --project: assistant messages record path.cwd; the session's `directory` is the fallback.
export const projectAware = true;

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
    session: m.sessionID,
    cwd: (typeof m.path?.cwd === 'string' && m.path.cwd) || undefined,
  };
  return ev.input + ev.output + ev.cacheRead + ev.cacheWrite > 0 ? ev : null;
}

/** session id -> directory, from the database and/or legacy session files. Missing tables are fine. */
export async function sessionDirs({ db, legacyDir } = {}) {
  const out = new Map();
  if (db) {
    const { rows } = await querySqlite(db, 'SELECT id, directory FROM session');
    for (const r of rows || []) if (r.directory) out.set(r.id, r.directory);
  }
  if (legacyDir && isDir(legacyDir)) {
    for (const f of walk(legacyDir, (n) => n.endsWith('.json'))) {
      try {
        const s = JSON.parse(readFileSync(f, 'utf8'));
        if (s?.id && typeof s.directory === 'string') out.set(s.id, s.directory);
      } catch {
        // skip unreadable file
      }
    }
  }
  return out;
}

/** Fill in `cwd` from the session directory where the message itself has no path. */
export function withSessionDirs(events, dirs) {
  for (const ev of events) {
    if (!ev.cwd && dirs.has(ev.session)) ev.cwd = dirs.get(ev.session);
    delete ev.session;
  }
  return events;
}

export async function load({ sinceMs = 0, untilMs = Infinity, env, project } = {}) {
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
    const { rows, error } = await querySqlite(db, `SELECT id, session_id, data FROM message WHERE time_created >= ${since}`);
    if (error) warnings.push(`OpenCode database skipped: ${error}`);
    else {
      details.push('opencode.db');
      for (const r of rows) {
        try {
          add(toEvent({ sessionID: r.session_id, ...JSON.parse(r.data) }, r.id));
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
  let events = [...byId.values()];
  if (project) events = withSessionDirs(events, await sessionDirs({ db: hasDb && db, legacyDir: join(dir, 'storage', 'session') }));
  return { found: true, detail: details.join(' + ') || 'unreadable', events, warnings };
}
