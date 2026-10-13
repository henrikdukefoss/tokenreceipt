import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export const fixture = (p = '') => fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url));

/** An env that points every reader at the fixture home and nothing else. */
export const fixtureEnv = (homeDir = fixture('home')) => ({ TOKENRECEIPT_HOME: homeDir });

export const offlinePrices = () => JSON.parse(readFileSync(new URL('../src/prices-fallback.json', import.meta.url), 'utf8')).prices;

export const sum = (events, k) => events.reduce((s, e) => s + e[k], 0);

/** Build a SQLite file from a fixture .sql script with node:sqlite or the sqlite3 CLI. Returns false if neither exists. */
export async function sqliteFromFixture(sqlFile, dbPath) {
  const { readFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  mkdirSync(dirname(dbPath), { recursive: true });
  const sql = readFileSync(fixture(sqlFile), 'utf8');
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec(sql);
    db.close();
    return true;
  } catch {
    try {
      execFileSync('sqlite3', [dbPath], { input: sql });
      return true;
    } catch {
      return false;
    }
  }
}
