#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { runCli } from '../../../cli/src/node/cli.js';
import { appCliArgv } from './cliArgv.js';
import { runHeadlessServe } from './serve.js';

declare const __ORCH_APP_VERSION__: string;
declare const __ORCH_ENGINE_VERSION__: string;

/** CLI-04 (a): start the app (or focus it through its single-instance lock). Only inside the app's own runtime. */
function openApp(repoRoot?: string): void {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = repoRoot ? ['--open-repo', repoRoot] : [];
  // An AppImage's mounted binary goes away when this process exits, so start the AppImage itself.
  const child = spawn(process.env.APPIMAGE ?? process.execPath, args, { detached: true, stdio: 'ignore', env });
  child.unref();
}

runCli(appCliArgv(process.argv), {
  serve: runHeadlessServe,
  ...(process.versions.electron ? { openApp } : {}),
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
