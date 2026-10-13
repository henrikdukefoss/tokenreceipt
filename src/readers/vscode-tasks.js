// Cline-family VS Code extensions keep one folder per task:
//   <editor user data>/User/globalStorage/<extension id>/tasks/<taskId>/ui_messages.json
// ui_messages.json is an array of { ts (ms), type, say, text, modelInfo? }. Usage is on
// say:"api_req_started" (plus Cline's "deleted_api_reqs" and "subagent_usage"), whose
// `text` is a JSON string { tokensIn, tokensOut, cacheWrites, cacheReads, cost, apiProtocol? }.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { home, isDir, num } from '../lib/fs.js';

const PRODUCTS = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor', 'Windsurf'];
const USAGE_SAYS = new Set(['api_req_started', 'deleted_api_reqs', 'subagent_usage']);
// Roo Code 3.29.5 (2025-10-31) switched tokensIn to include cache reads and writes.
const ROO_INCLUSIVE_FROM = Date.parse('2025-10-31T00:00:00Z');

/** Editor user-data directories that exist on this platform. */
export function editorDirs(env = process.env, platform = process.platform) {
  const h = home(env);
  let base;
  if (platform === 'darwin') base = join(h, 'Library', 'Application Support');
  else if (platform === 'win32') base = env.APPDATA || join(h, 'AppData', 'Roaming');
  else base = env.XDG_CONFIG_HOME || join(h, '.config');
  const dirs = PRODUCTS.map((p) => join(base, p));
  if (env.VSCODE_PORTABLE) dirs.unshift(join(env.VSCODE_PORTABLE, 'user-data'));
  return dirs;
}

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

/** Latest entry at or before ts from a ts-sorted list of [ts, value]. */
function at(list, ts) {
  let v = null;
  for (const [t, val] of list) {
    if (t <= ts) v = val;
    else break;
  }
  return v ?? list[0]?.[1] ?? null;
}

/** Roo/Kilo: the model is only recorded as <model>id</model> in each turn's environment details. */
function modelsFromHistory(taskDir) {
  const hist = readJson(join(taskDir, 'api_conversation_history.json'));
  const out = [];
  if (!Array.isArray(hist)) return out;
  for (const m of hist) {
    const text = typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((b) => b?.text || '').join('\n') : '';
    const match = /<model>([^<]+)<\/model>/.exec(text);
    if (match && m.ts) out.push([m.ts, match[1].trim()]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Cline: task_metadata.json model_usage [{ ts, model_id, model_provider_id }] for files older than 3.37. */
function modelsFromMetadata(taskDir) {
  const meta = readJson(join(taskDir, 'task_metadata.json'));
  const list = Array.isArray(meta?.model_usage) ? meta.model_usage : [];
  return list.filter((u) => u?.model_id).map((u) => [num(u.ts), { id: u.model_id, provider: u.model_provider_id }]).sort((a, b) => a[0] - b[0]);
}

export function parseTask(taskDir, { agent, flavor, sinceMs = 0, untilMs = Infinity }) {
  const msgs = readJson(join(taskDir, 'ui_messages.json'));
  if (!Array.isArray(msgs)) return [];
  let models;
  const events = [];
  for (const m of msgs) {
    if (m?.type !== 'say' || !USAGE_SAYS.has(m.say) || typeof m.text !== 'string') continue;
    const ts = num(m.ts);
    if (!(ts >= sinceMs && ts < untilMs)) continue;
    let u;
    try {
      u = JSON.parse(m.text);
    } catch {
      continue;
    }
    const tokensIn = num(u.tokensIn);
    const cacheRead = num(u.cacheReads);
    const cacheWrite = num(u.cacheWrites);
    const output = num(u.tokensOut);
    if (!tokensIn && !cacheRead && !cacheWrite && !output) continue;

    let model;
    let provider;
    if (flavor === 'cline') {
      if (m.modelInfo?.modelId) ({ modelId: model, providerId: provider } = m.modelInfo);
      else {
        models ??= modelsFromMetadata(taskDir);
        const hit = at(models, ts);
        model = hit?.id;
        provider = hit?.provider;
      }
    } else {
      models ??= modelsFromHistory(taskDir);
      model = at(models, ts);
    }
    const inclusive = flavor === 'roo' && (ts >= ROO_INCLUSIVE_FROM || u.apiProtocol === 'openai');
    events.push({
      agent,
      model: model || 'unknown',
      provider,
      ts,
      input: inclusive ? Math.max(0, tokensIn - cacheRead - cacheWrite) : tokensIn,
      output,
      cacheRead,
      cacheWrite,
      cacheWrite1h: 0,
    });
  }
  return events;
}

/** Load every task folder under the given `<...>/tasks` directories. */
export function loadTaskDirs(taskRoots, { agent, flavor, sinceMs = 0, untilMs = Infinity }) {
  const roots = [...new Set(taskRoots)].filter(isDir);
  if (!roots.length) return { found: false };
  const events = [];
  let tasks = 0;
  for (const root of roots) {
    let ids = [];
    try {
      ids = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const taskId of ids) {
      const evs = parseTask(join(root, taskId), { agent, flavor, sinceMs, untilMs });
      if (evs.length) tasks++;
      events.push(...evs);
    }
  }
  return { found: true, roots, tasks, events };
}

export const globalStorageTasks = (env, platform, extensionId) =>
  editorDirs(env, platform).map((d) => join(d, 'User', 'globalStorage', extensionId, 'tasks'));
