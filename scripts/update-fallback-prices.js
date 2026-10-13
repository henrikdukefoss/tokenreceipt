#!/usr/bin/env node
// Regenerates src/prices-fallback.json (used by --offline / when the fetch fails)
// from LiteLLM's public price list. Keeps first-party vendor entries only.
import { writeFileSync } from 'node:fs';
import { PRICES_URL, slimPrices } from '../src/pricing.js';

const FIRST_PARTY = new Set(['anthropic', 'openai', 'text-completion-openai', 'gemini', 'vertex_ai-language-models', 'deepseek', 'xai', 'mistral', 'moonshot', 'zai', 'dashscope', 'minimax']);
const PREFIXED = /^(gemini|deepseek|xai|mistral|moonshot|zai|dashscope|minimax|openrouter)\//;

const res = await fetch(PRICES_URL);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const raw = await res.json();
const slim = slimPrices(raw);
const prices = {};
for (const k of Object.keys(slim).sort()) {
  const provider = raw[k].litellm_provider;
  if ((!k.includes('/') && FIRST_PARTY.has(provider)) || PREFIXED.test(k)) prices[k] = slim[k];
}
const out = { source: PRICES_URL, fetchedAt: Date.now(), prices };
writeFileSync(new URL('../src/prices-fallback.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`wrote ${Object.keys(prices).length} models`);
