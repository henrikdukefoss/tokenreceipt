// --project over synthetic fixtures with two projects (/work/alpha and /work/beta) plus traps:
// /work/alpha/packages/web (inside alpha) and /work/alpha-two (same prefix, different project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli.js';
import { claudeSlug, geminiHash, projectMatcher, resolveProject } from '../src/project.js';
import { readAll } from '../src/readers/index.js';
import { fixture, sqliteFromFixture } from './helpers.js';

const HOME = fixture('projects-home');
const env = { TOKENRECEIPT_HOME: HOME };
const tokens = (evs) => evs.reduce((s, e) => s + e.input + e.output + e.cacheRead + e.cacheWrite, 0);
const perAgent = (scan) => Object.fromEntries(scan.found.map((f) => [f.id, tokens(scan.events.filter((e) => e.agent === f.id))]));

test('projectMatcher: inside the folder, not a sibling with the same prefix', () => {
  const m = projectMatcher('/work/alpha/');
  assert.equal(m.root, '/work/alpha');
  assert.equal(m.inside('/work/alpha'), true);
  assert.equal(m.inside('/work/alpha/'), true);
  assert.equal(m.inside('/work/alpha/packages/web'), true);
  assert.equal(m.inside('/work/alpha-two'), false);
  assert.equal(m.inside('/work'), false);
  assert.equal(m.matches({ cwd: '/work/beta' }), false);
  assert.equal(m.matches({ claudeSlug: claudeSlug('/work/alpha') }), true);
  assert.equal(m.matches({ claudeSlug: claudeSlug('/work/alpha-two') }), false);
  assert.equal(m.matches({ geminiHash: geminiHash('/work/alpha') }), true);
  assert.equal(m.matches({}), null);
});

test('resolveProject widens to the git root; a missing folder is kept as given', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tokenreceipt-repo-')));
  try {
    mkdirSync(join(dir, '.git'));
    mkdirSync(join(dir, 'packages', 'web'), { recursive: true });
    assert.equal(resolveProject('.', join(dir, 'packages', 'web')), dir);
    assert.equal(resolveProject(join(dir, 'packages')), dir);
    assert.equal(resolveProject('/work/alpha'), '/work/alpha');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseArgs: --project takes an optional path', () => {
  assert.equal(parseArgs(['--project']).project, '.');
  assert.equal(parseArgs(['--project', '--badge']).project, '.');
  assert.equal(parseArgs(['--project', '/work/alpha']).project, '/work/alpha');
  assert.equal(parseArgs(['--project=../x']).project, '../x');
  assert.equal(parseArgs(['--all-projects']).allProjects, true);
});

test('readers: per-agent totals for two projects', async () => {
  const opts = { env, platform: 'linux', sinceMs: 0, untilMs: Infinity };
  const alpha = await readAll({ ...opts, project: projectMatcher('/work/alpha') });
  assert.deepEqual(perAgent(alpha), {
    'claude-code': 1100 + 2200 + 330, // cwd, subfolder, folder-slug fallback; alpha-two left out
    codex: 1100, // second turn moved to /work/beta
    opencode: 880 + 110, // path.cwd on the message, session directory for the other
    'gemini-cli': 2200 + 440, // .project_root marker and the old sha256 folder
    cline: 660 + 550, // classic task environment details + SDK session manifest
    'roo-code': 440,
    'kilo-code': 440,
    pi: 1650,
  });
  assert.deepEqual(alpha.skipped, []);
  const beta = await readAll({ ...opts, project: projectMatcher('/work/beta') });
  assert.deepEqual(perAgent(beta), {
    'claude-code': 5500,
    codex: 4400 + 9900,
    opencode: 990,
    'gemini-cli': 3300, // projects.json registry
    cline: 770,
    'roo-code': 4400,
    'kilo-code': 4400,
    pi: 6600,
  });
  const all = await readAll(opts);
  assert.equal(tokens(all.events), tokens(alpha.events) + tokens(beta.events) + 7700); // + alpha-two
});

test('opencode and kilo databases: message path, then session directory', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenreceipt-projdb-'));
  try {
    const db = join(dir, 'opencode', 'opencode.db');
    if (!(await sqliteFromFixture('projects-opencode.sql', db))) return t.skip('no sqlite');
    const e = { TOKENRECEIPT_HOME: '/nonexistent', XDG_DATA_HOME: dir, KILO_DB: db };
    const scan = await readAll({ env: e, platform: 'linux', sinceMs: 0, untilMs: Infinity, project: projectMatcher('/work/alpha') }, ['opencode', 'kilo-code']);
    assert.deepEqual(perAgent(scan), { opencode: 1100 + 220, 'kilo-code': 1100 + 220 });
    assert.ok(scan.warnings.some((w) => /OpenCode: 1 request with no recorded folder/.test(w)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hermes cannot be attributed to a folder: skipped with a reason', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tokenreceipt-projhermes-'));
  try {
    if (!(await sqliteFromFixture('hermes.sql', join(dir, 'state.db')))) return t.skip('no sqlite');
    const scan = await readAll({ env: { TOKENRECEIPT_HOME: HOME, HERMES_HOME: dir }, sinceMs: 0, untilMs: Infinity, project: projectMatcher('/work/alpha') }, ['hermes', 'pi']);
    assert.deepEqual(scan.skipped.map((s) => s.id), ['hermes']);
    assert.match(scan.skipped[0].reason, /no working directory/);
    assert.deepEqual(perAgent(scan), { pi: 1650 });
    const res = run(['--since', 'all', '--offline', '--json', '--project', '/work/alpha', '--agent', 'hermes,pi'], { HERMES_HOME: dir });
    assert.match(res.stderr, /note: skipped for --project, no per-project attribution: Hermes \(state\.db records no working directory per session\)/);
    assert.deepEqual(JSON.parse(res.stdout).project.skipped.map((s) => s.id), ['hermes']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const bin = fileURLToPath(new URL('../bin/tokenreceipt.js', import.meta.url));
// Roo and Kilo fixtures sit in the Linux VS Code folder, so CLI totals name the agents found on every OS.
const PORTABLE = ['--agent', 'claude-code,codex,opencode,gemini-cli,cline,pi'];
function run(args, extraEnv = {}, cwd) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: { PATH: process.env.PATH, TOKENRECEIPT_HOME: HOME, XDG_CACHE_HOME: join(tmpdir(), 'tokenreceipt-test-cache'), NO_COLOR: '1', ...extraEnv },
    encoding: 'utf8',
  });
}

test('cli: --badge --project counts one project and says so', () => {
  const alpha = run(['--since', 'all', '--offline', '--badge', '--project', '/work/alpha', ...PORTABLE]);
  assert.equal(alpha.status, 0);
  assert.equal(
    alpha.stdout,
    '[![Built with 11.2K tokens](https://img.shields.io/badge/built%20with-11.2K%20tokens-1d2434 "Counted by tokenreceipt for this project from all available local agent logs")](https://github.com/henrikdukefoss/tokenreceipt)\n',
  );
  assert.match(alpha.stderr, /project: \/work\/alpha\n/);
  const beta = JSON.parse(run(['--since', 'all', '--offline', '--json', '--project=/work/beta', ...PORTABLE]).stdout);
  assert.equal(beta.totals.tokens, 31_460);
  assert.equal(beta.project.root, '/work/beta');
  const everything = JSON.parse(run(['--since', 'all', '--offline', '--json', ...PORTABLE]).stdout);
  assert.equal(everything.totals.tokens, 11_220 + 31_460 + 7_700);
  assert.equal(everything.project, null);
  assert.equal(run(['--offline', '--badge', '--project', '--all-projects']).status, 2);
  assert.match(run(['--since', 'all', '--offline', '--project', '/work/alpha', ...PORTABLE]).stdout, /PROJECT +alpha/);
});

test('cli: inside a git repo --badge defaults to that repo; --all-projects opts out', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tokenreceipt-badge-')));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(join(repo, 'src'));
    const line = (cwd, id, n) =>
      JSON.stringify({ type: 'assistant', cwd, timestamp: '2026-09-20T10:00:00.000Z', message: { model: 'claude-sonnet-4-5', id, usage: { input_tokens: n, output_tokens: 0 } }, requestId: id }) + '\n';
    mkdirSync(join(dir, 'home', '.claude', 'projects', 'p'), { recursive: true });
    writeFileSync(join(dir, 'home', '.claude', 'projects', 'p', 'in.jsonl'), line(join(repo, 'src'), 'm1', 4000));
    writeFileSync(join(dir, 'home', '.claude', 'projects', 'p', 'out.jsonl'), line(join(dir, 'other'), 'm2', 96000));
    const home = { TOKENRECEIPT_HOME: join(dir, 'home') };
    const inRepo = run(['--since', 'all', '--offline', '--badge'], home, join(repo, 'src'));
    assert.match(inRepo.stdout, /Built with 4\.0K tokens.*for this project/);
    assert.match(inRepo.stderr, /--all-projects counts every project/);
    const all = run(['--since', 'all', '--offline', '--badge', '--all-projects'], home, join(repo, 'src'));
    assert.match(all.stdout, /Built with 100\.0K tokens/);
    assert.doesNotMatch(all.stdout, /this project/);
    const outside = run(['--since', 'all', '--offline', '--badge'], home, dir);
    assert.match(outside.stdout, /Built with 100\.0K tokens/);
    assert.match(outside.stderr, /not only this repo/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
