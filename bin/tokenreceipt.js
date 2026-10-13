#!/usr/bin/env node
import { main } from '../src/cli.js';

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`tokenreceipt: ${err?.stack || err}`);
    process.exitCode = 1;
  },
);
