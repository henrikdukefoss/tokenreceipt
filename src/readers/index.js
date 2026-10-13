import * as claude from './claude.js';
import * as codex from './codex.js';
import * as opencode from './opencode.js';
import * as gemini from './gemini.js';
import * as cline from './cline.js';
import * as roo from './roo.js';
import * as kilo from './kilo.js';
import * as pi from './pi.js';
import * as hermes from './hermes.js';

export const readers = [claude, codex, opencode, gemini, cline, roo, kilo, pi, hermes];

/**
 * Run every reader. Missing agents are skipped. Returns
 * { events, found:[{id,name,detail,events}], missing:[name], warnings:[] }.
 */
export async function readAll(opts, only) {
  const events = [];
  const found = [];
  const missing = [];
  const warnings = [];
  for (const r of readers) {
    if (only && !only.includes(r.id)) continue;
    let res;
    try {
      res = await r.load(opts);
    } catch (err) {
      warnings.push(`${r.name}: skipped (${err.message})`);
      continue;
    }
    if (res.warnings) warnings.push(...res.warnings);
    if (!res.found) {
      missing.push(r.name);
      continue;
    }
    const evs = res.events || [];
    found.push({ id: r.id, name: r.name, detail: res.detail, events: evs.length });
    for (const e of evs) events.push(e);
  }
  return { events, found, missing, warnings };
}

export const agentNames = Object.fromEntries(readers.map((r) => [r.id, r.name]));
