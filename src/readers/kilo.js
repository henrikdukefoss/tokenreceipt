// Kilo Code, both generations:
//  - current (7.x, an OpenCode fork shared by the CLI and the editor extensions):
//    ${KILO_DB} or ${XDG_DATA_HOME:-~/.local/share}/kilo/kilo.db, same `message` table as OpenCode.
//  - legacy (Roo Code fork, up to 5.x): <editor>/User/globalStorage/kilocode.kilo-code/tasks/<id>/
//    Sessions imported from legacy into the new database have modelID "legacy" and zero tokens.
import { join } from 'node:path';
import { home, isFile } from '../lib/fs.js';
import { querySqlite } from '../lib/sqlite.js';
import { sessionDirs, toEvent, withSessionDirs } from './opencode.js';
import { globalStorageTasks, loadTaskDirs } from './vscode-tasks.js';

export const id = 'kilo-code';
export const name = 'Kilo Code';
// --project: kilo.db messages record path.cwd (session directory as fallback); legacy tasks
// record the workspace directory in their environment details.
export const projectAware = true;

export function dbPath(env = process.env) {
  return env.KILO_DB || join(env.XDG_DATA_HOME || join(home(env), '.local', 'share'), 'kilo', 'kilo.db');
}

export async function load({ sinceMs = 0, untilMs = Infinity, env = process.env, platform, project } = {}) {
  const legacy = loadTaskDirs(globalStorageTasks(env, platform, 'kilocode.kilo-code'), { agent: id, flavor: 'roo', sinceMs, untilMs, project });
  const db = dbPath(env);
  const hasDb = isFile(db);
  if (!legacy.found && !hasDb) return { found: false };
  const events = legacy.events || [];
  const warnings = [];
  const parts = [];
  if (hasDb) {
    const dbEvents = [];
    const { rows, error } = await querySqlite(db, `SELECT id, session_id, data FROM message WHERE time_created >= ${Math.floor(sinceMs) || 0}`);
    if (error) warnings.push(`Kilo Code database skipped: ${error}`);
    else {
      parts.push('kilo.db');
      for (const r of rows) {
        let ev;
        try {
          ev = toEvent({ sessionID: r.session_id, ...JSON.parse(r.data) }, r.id);
        } catch {
          continue;
        }
        if (!ev || ev.model === 'legacy' || !(ev.ts >= sinceMs && ev.ts < untilMs)) continue;
        dbEvents.push({ ...ev, agent: id });
      }
    }
    if (project) withSessionDirs(dbEvents, await sessionDirs({ db }));
    for (const ev of dbEvents) {
      delete ev.session;
      events.push(ev);
    }
  }
  if (legacy.found) parts.push(`${legacy.tasks} legacy task${legacy.tasks === 1 ? '' : 's'}`);
  return { found: true, detail: parts.join(' + ') || 'unreadable', events, warnings };
}
