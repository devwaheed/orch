#!/usr/bin/env node
import { runCli } from './cli.js';

runCli(process.argv)
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
