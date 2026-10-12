#!/usr/bin/env node
import { runCli } from '../../../cli/src/node/cli.js';
import { runHeadlessServe } from './serve.js';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
declare const __ORCH_APP_VERSION__: string;
declare const __ORCH_ENGINE_VERSION__: string;

function openApp(repoRoot?: string): void {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = repoRoot ? ['--open-repo', repoRoot] : [];
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', env });
  child.unref();
}

runCli(process.argv, {
  serve: runHeadlessServe,
  openApp,
  appVersion: typeof __ORCH_APP_VERSION__ === 'undefined' ? '1.0.0' : __ORCH_APP_VERSION__,
  engineVersion: typeof __ORCH_ENGINE_VERSION__ === 'undefined' ? 'unknown' : __ORCH_ENGINE_VERSION__,
  stdoutIsTTY: process.stdout.isTTY,
  env: process.env,
  platform: platform(),
})
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
