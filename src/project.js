// --project: keep only sessions whose recorded working directory is inside one folder.
// Readers that know where a session ran set `cwd` on its events (or, when only a folder
// name survives, `claudeSlug` / `geminiHash`). Events without any of those are dropped.
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

/** The git repository root that contains `dir`, or null. A `.git` file (worktree, submodule) counts. */
export function gitRoot(dir) {
  let d = resolve(dir);
  for (;;) {
    if (existsSync(join(d, '.git'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** Resolve a --project value: absolute path, widened to the git root when inside a repo. */
export function resolveProject(p = '.', cwd = process.cwd()) {
  const abs = trimSep(resolve(cwd, p));
  // a folder that no longer exists is used as given (its logs can outlive it)
  if (!existsSync(abs)) return abs;
  return gitRoot(abs) || abs;
}

const trimSep = (p) => (p.length > 1 && /[\\/]$/.test(p) ? p.slice(0, -1) : p);
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/** Claude Code names a project folder after its path with every non-alphanumeric character turned into "-". */
export const claudeSlug = (p) => p.replace(/[^a-zA-Z0-9]/g, '-');
/** Older Gemini CLI versions name the folder after sha256(project root). */
export const geminiHash = (p) => createHash('sha256').update(p).digest('hex');

export function projectMatcher(root, { platform = process.platform } = {}) {
  const fold = platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;
  const roots = [...new Set([resolve(root), real(root)].filter(Boolean).map(trimSep))];
  const prefixes = roots.map((r) => fold(r === sep ? r : r + sep));
  const exact = new Set(roots.map(fold));
  const slugs = new Set(roots.map(claudeSlug));
  const hashes = new Set(roots.map(geminiHash));
  const memo = new Map();
  const inside = (p) => {
    if (typeof p !== 'string' || !p) return false;
    if (memo.has(p)) return memo.get(p);
    const candidates = [trimSep(resolve(p))];
    const r = real(p);
    if (r && r !== candidates[0]) candidates.push(trimSep(r));
    const ok = candidates.some((c) => exact.has(fold(c)) || prefixes.some((pre) => fold(c).startsWith(pre)));
    memo.set(p, ok);
    return ok;
  };
  return {
    root: roots[0],
    inside,
    /** true / false for attributed events, null when the event carries no location at all. */
    matches(ev) {
      if (ev.cwd) return inside(ev.cwd);
      // folder-name fallbacks only identify the exact root, not subfolders
      if (ev.claudeSlug) return slugs.has(ev.claudeSlug);
      if (ev.geminiHash) return hashes.has(ev.geminiHash);
      return null;
    },
  };
}
