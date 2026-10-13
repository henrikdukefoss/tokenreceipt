// Cline. Two on-disk generations, read together:
//  1. Classic extension: <editor>/User/globalStorage/saoudrizwan.claude-dev/tasks/<id>/ui_messages.json
//     (and ${CLINE_DIR:-~/.cline}/data/tasks for the old standalone CLI). tokensIn excludes cache.
//     The model is message.modelInfo.modelId (3.37+) or task_metadata.json model_usage.
//  2. SDK-based extension (4.1+) and new CLI: ${CLINE_DIR:-~/.cline}/data/sessions/<id>/*.messages.json
//     { messages: [{ id, role, ts, modelInfo: { id, provider }, metrics: { inputTokens, outputTokens,
//     cacheReadTokens, cacheWriteTokens } }] }. inputTokens includes cache reads and writes.
//     A legacy task resumed in the SDK gets one converted message with the whole legacy total
//     (provider "unknown", no ts); it is skipped because the legacy files are counted above.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { home, isDir, num, walk } from '../lib/fs.js';
import { globalStorageTasks, loadTaskDirs } from './vscode-tasks.js';

export const id = 'cline';
export const name = 'Cline';

const clineDir = (env) => env.CLINE_DIR || join(home(env), '.cline');

export function sessionRoots(env = process.env) {
  if (env.CLINE_SESSION_DATA_DIR) return [env.CLINE_SESSION_DATA_DIR];
  if (env.CLINE_DATA_DIR) return [join(env.CLINE_DATA_DIR, 'sessions')];
  return [join(clineDir(env), 'data', 'sessions')];
}

export function sdkEvents(file, { sinceMs = 0, untilMs = Infinity } = {}) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const out = [];
  for (const m of Array.isArray(doc?.messages) ? doc.messages : []) {
    const x = m?.metrics;
    if (!x || m.role !== 'assistant') continue;
    if (!m.ts || m.modelInfo?.provider === 'unknown') continue; // converted legacy totals
    const ts = num(m.ts);
    if (!(ts >= sinceMs && ts < untilMs)) continue;
    const cacheRead = num(x.cacheReadTokens);
    const cacheWrite = num(x.cacheWriteTokens);
    const ev = {
      agent: id,
      key: `${doc.sessionId || file}:${m.id}`,
      model: m.modelInfo?.id || 'unknown',
      provider: m.modelInfo?.provider,
      ts,
      input: Math.max(0, num(x.inputTokens) - cacheRead - cacheWrite),
      output: num(x.outputTokens),
      cacheRead,
      cacheWrite,
      cacheWrite1h: 0,
    };
    if (ev.input + ev.output + ev.cacheRead + ev.cacheWrite > 0) out.push(ev);
  }
  return out;
}

export async function load({ sinceMs = 0, untilMs = Infinity, env = process.env, platform } = {}) {
  const legacy = loadTaskDirs([...globalStorageTasks(env, platform, 'saoudrizwan.claude-dev'), join(clineDir(env), 'data', 'tasks')], {
    agent: id,
    flavor: 'cline',
    sinceMs,
    untilMs,
  });
  const sdkDirs = sessionRoots(env).filter(isDir);
  if (!legacy.found && !sdkDirs.length) return { found: false };
  const events = legacy.events || [];
  const files = sdkDirs.flatMap((d) => walk(d, (n) => n.endsWith('.messages.json'), sinceMs));
  const seen = new Set();
  for (const f of files) {
    for (const ev of sdkEvents(f, { sinceMs, untilMs })) {
      if (seen.has(ev.key)) continue;
      seen.add(ev.key);
      delete ev.key;
      events.push(ev);
    }
  }
  const parts = [];
  if (legacy.found) parts.push(`${legacy.tasks} task${legacy.tasks === 1 ? '' : 's'}`);
  if (sdkDirs.length) parts.push(`${files.length} session file${files.length === 1 ? '' : 's'}`);
  return { found: true, detail: parts.join(' + '), events };
}
