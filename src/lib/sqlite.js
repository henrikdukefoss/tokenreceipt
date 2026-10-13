import { execFileSync } from 'node:child_process';

/**
 * Run a read-only query against a SQLite file without runtime dependencies.
 * Uses node:sqlite (Node >= 22.5) when available, else the `sqlite3` CLI.
 * Returns { rows } or { error } describing why it could not be read.
 */
export async function querySqlite(file, sql) {
  const mod = await loadNodeSqlite();
  if (mod) {
    try {
      const db = new mod.DatabaseSync(file, { readOnly: true });
      try {
        return { rows: db.prepare(sql).all() };
      } finally {
        db.close();
      }
    } catch (err) {
      // fall through to the CLI (e.g. database locked, unsupported options)
      if (!hasSqliteCli()) return { error: `could not read ${file}: ${err.message}` };
    }
  }
  if (!hasSqliteCli()) {
    return { error: 'needs Node >= 22.5 (node:sqlite) or the sqlite3 command-line tool' };
  }
  try {
    const out = execFileSync('sqlite3', ['-readonly', '-json', file, sql], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { rows: out.trim() ? JSON.parse(out) : [] };
  } catch (err) {
    return { error: `sqlite3 failed: ${String(err.stderr || err.message).trim().split('\n')[0]}` };
  }
}

let nodeSqlite;
async function loadNodeSqlite() {
  if (nodeSqlite !== undefined) return nodeSqlite;
  if (process.env.TOKENRECEIPT_NO_NODE_SQLITE) return (nodeSqlite = null);
  // node:sqlite prints an ExperimentalWarning on some versions; keep stderr clean.
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => {
    if (String(w?.message ?? w).includes('SQLite')) return;
    return emit.call(process, w, ...rest);
  };
  try {
    nodeSqlite = await import('node:sqlite');
  } catch {
    nodeSqlite = null;
  } finally {
    process.emitWarning = emit;
  }
  return nodeSqlite;
}

let cli;
function hasSqliteCli() {
  if (cli !== undefined) return cli;
  try {
    execFileSync('sqlite3', ['-version'], { stdio: 'ignore' });
    cli = true;
  } catch {
    cli = false;
  }
  return cli;
}
