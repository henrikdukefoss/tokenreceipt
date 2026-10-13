import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export const home = (env = process.env) => env.TOKENRECEIPT_HOME || homedir();

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export { existsSync };

/**
 * Recursively list files under `dir` whose name passes `match`.
 * Skips files last modified before `minMtimeMs` (they cannot hold newer events).
 */
export function walk(dir, match, minMtimeMs = 0, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, match, minMtimeMs, out);
    else if (e.isFile() && match(e.name)) {
      if (minMtimeMs) {
        try {
          if (statSync(p).mtimeMs < minMtimeMs) continue;
        } catch {
          continue;
        }
      }
      out.push(p);
    }
  }
  return out;
}

/** Stream a JSONL file line by line. `prefilter` avoids JSON.parse on irrelevant lines. */
export async function* readJsonl(file, prefilter) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || (prefilter && !prefilter(line))) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // partial or corrupt line (file still being written) - skip
    }
  }
}

export const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function toMs(ts) {
  if (ts == null) return NaN;
  if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts;
  return Date.parse(ts);
}
