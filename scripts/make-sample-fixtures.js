#!/usr/bin/env node
// Writes test/fixtures/sample-home: a synthetic, deterministic month of agent usage
// in each agent's real on-disk format. Used for the README sample receipt.
// Everything here is made up (seeded PRNG); no real logs are involved.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../test/fixtures/sample-home', import.meta.url));
rmSync(root, { recursive: true, force: true });

let seed = 42;
const rand = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 2 ** 32);
const int = (lo, hi) => Math.round(lo + rand() * (hi - lo));
const START = Date.parse('2026-09-02T08:00:00Z');
const DAYS = 29;
const when = (i, n) => new Date(START + Math.floor((i / n) * DAYS) * 86400000 + int(0, 12 * 3600) * 1000);

function write(rel, lines) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
}

// Claude Code: one session file per few days, assistant lines with message.usage
{
  const mix = [
    ['claude-sonnet-5', 520, [60000, 180000], [800, 4000]],
    ['claude-opus-5-5', 140, [80000, 220000], [1000, 6000]],
    ['claude-haiku-5-5', 90, [20000, 60000], [200, 1200]],
  ];
  const lines = [];
  let k = 0;
  for (const [model, n, cr, out] of mix) {
    for (let i = 0; i < n; i++, k++) {
      const ts = when(i, n);
      const cw = rand() < 0.15 ? int(8000, 40000) : int(200, 3000);
      lines.push({
        ts: ts.getTime(),
        line: {
          type: 'assistant',
          timestamp: ts.toISOString(),
          sessionId: `sample-${k % 9}`,
          requestId: `req_sample_${k}`,
          message: {
            id: `msg_sample_${k}`,
            model,
            role: 'assistant',
            usage: { input_tokens: int(1, 40), output_tokens: int(...out), cache_read_input_tokens: int(...cr), cache_creation_input_tokens: cw },
          },
        },
      });
    }
  }
  lines.sort((a, b) => a.ts - b.ts);
  const chunk = Math.ceil(lines.length / 9);
  for (let s = 0; s < 9; s++) {
    write(`.claude/projects/-Users-sample-project/sample-${s}.jsonl`, lines.slice(s * chunk, (s + 1) * chunk).map((l) => l.line));
  }
}

// Codex CLI: rollout files with token_usage_record lines
for (let s = 0; s < 6; s++) {
  const n = 35;
  const sid = `0199sample${s}`;
  const lines = [
    { timestamp: when(s, 6).toISOString(), type: 'session_meta', payload: { id: sid, cwd: '/Users/sample/project', cli_version: '0.150.0', model_provider: 'openai' } },
    { timestamp: when(s, 6).toISOString(), type: 'turn_context', payload: { turn_id: `t${s}`, model: s < 4 ? 'gpt-6-astra' : 'gpt-5.6-terra' } },
  ];
  for (let i = 0; i < n; i++) {
    const input = int(30000, 140000);
    const cached = Math.round(input * (0.7 + rand() * 0.25));
    const output = int(500, 5000);
    lines.push({
      timestamp: new Date(when(s, 6).getTime() + i * 40000).toISOString(),
      type: 'token_usage_record',
      payload: { thread_id: sid, turn_id: `t${s}`, session_id: sid, response_id: `resp_sample_${s}_${i}`, usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: Math.round(output * 0.4), total_tokens: input + output } },
    });
  }
  const d = when(s, 6);
  const p = (x) => String(x).padStart(2, '0');
  write(`.codex/sessions/${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/rollout-sample-${sid}.jsonl`, lines);
}

// OpenCode: legacy one-file-per-message storage (no SQLite needed to read the sample)
{
  const mix = [
    ['glm-5.3', 'zai', 45],
    ['kimi-k3', 'moonshot', 20],
  ];
  let k = 0;
  for (const [modelID, providerID, n] of mix) {
    for (let i = 0; i < n; i++, k++) {
      const created = when(i, n).getTime();
      const msg = {
        id: `msg_sample_${k}`,
        sessionID: `ses_sample_${k % 5}`,
        role: 'assistant',
        modelID,
        providerID,
        time: { created, completed: created + 9000 },
        cost: 0,
        tokens: { input: int(500, 6000), output: int(300, 3000), reasoning: int(0, 800), cache: { read: int(40000, 160000), write: 0 } },
      };
      write(`.local/share/opencode/storage/message/${msg.sessionID}/${msg.id}.json`, [msg]);
    }
  }
}

// Gemini CLI: JSONL chat recording with tokens on "gemini" messages
{
  const lines = [{ sessionId: 'sample01', projectHash: 'sample-project', startTime: when(0, 1).toISOString() }];
  for (let i = 0; i < 60; i++) {
    const input = int(20000, 90000);
    lines.push({
      id: `g${i}`,
      timestamp: when(i, 60).toISOString(),
      type: 'gemini',
      content: '',
      model: 'gemini-3.5-flash',
      tokens: { input, output: int(300, 2500), cached: Math.round(input * 0.6), thoughts: int(0, 900), tool: 0, total: 0 },
    });
    const t = lines[lines.length - 1].tokens;
    t.total = t.input + t.output + t.thoughts + t.tool;
  }
  write('.gemini/tmp/sample-project/chats/session-2026-09-02T08-00-sample01.jsonl', lines);
}

console.log(`wrote ${root}`);
