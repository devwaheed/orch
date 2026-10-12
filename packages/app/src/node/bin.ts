#!/usr/bin/env node
import { runCli } from '../../../cli/src/node/cli.js';
import { runHeadlessServe } from './serve.js';
import { appCliArgv } from './cliArgv.js';

runCli(appCliArgv(process.argv), { serve: runHeadlessServe })
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
