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
 * { events, found:[{id,name,detail,events}], missing:[name], warnings:[], skipped:[{id,name,reason}] }.
 * With opts.project (a projectMatcher), only events recorded inside that folder are kept;
 * agents whose logs record no folder are skipped and listed in `skipped`.
 */
export async function readAll(opts, only) {
  const events = [];
  const found = [];
  const missing = [];
  const warnings = [];
  const skipped = [];
  const { project } = opts;
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
    if (project && !r.projectAware) {
      // installed, but its sessions cannot be tied to a folder
      skipped.push({ id: r.id, name: r.name, reason: r.projectNote || 'its logs record no project folder' });
      continue;
    }
    let evs = res.events || [];
    if (project) {
      let unattributed = 0;
      evs = evs.filter((e) => {
        const m = project.matches(e);
        if (m === null) unattributed++;
        return m === true;
      });
      if (unattributed) warnings.push(`${r.name}: ${unattributed} request${unattributed === 1 ? '' : 's'} with no recorded folder left out of --project`);
    }
    found.push({ id: r.id, name: r.name, detail: res.detail, events: evs.length });
    for (const e of evs) events.push(e);
  }
  return { events, found, missing, warnings, skipped };
}

export const agentNames = Object.fromEntries(readers.map((r) => [r.id, r.name]));
