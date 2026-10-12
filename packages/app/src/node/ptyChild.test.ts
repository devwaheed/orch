/**
 * Kill-the-host test (S2-06). The PTY host runs as a real child process (the
 * Node entry, with IPC). The test opens a real shell, kills the host process
 * with SIGKILL, and checks that the shell is reported exited (the UI shows
 * "Terminal stopped · Restart"). Then it waits for the supervisor to restart the
 * host and checks that a new shell runs a real command.
 *
 * Skipped on Windows: ConPTY is not exercised by this suite yet.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { OrchEvent, ShellId } from '@orchagents/contracts';
import { PtyHostChild, type PtyHostChildOptions } from './ptyChild.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(here, 'ptyHost.ts');
const LOADER = pathToFileURL(path.resolve(here, '../../test/support/ts-loader.mjs')).href;

function baseEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

async function until(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const options: PtyHostChildOptions = {
  entry: ENTRY,
  args: [],
  execArgv: ['--import', LOADER],
  env: baseEnv(),
};

let child: PtyHostChild | null = null;
let cwd = '';

afterAll(() => {
  child?.dispose();
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('PTY host child process', () => {
  it('kill the host: open shells report stopped, the host restarts, and a new shell works', async () => {
    cwd = mkdtempSync(path.join(tmpdir(), 'orch-pty-kill-'));
    let readyCount = 0;
    child = new PtyHostChild(options, () => {
      readyCount += 1;
    });
    child.start();
    await until(() => child?.state === 'ready', 20_000, 'the PTY host to start');
    const firstPid = child.pid;
    expect(firstPid).not.toBeNull();

    const firstService = child.getService();
    expect(firstService).not.toBeNull();
    if (!firstService) return;

    const exited: Array<{ shellId: string; code: number | null }> = [];
    const output: string[] = [];
    firstService.onEvent((event: OrchEvent) => {
      if (event.type === 'shell.exited') exited.push({ shellId: event.shellId, code: event.code });
      if (event.type === 'shell.output') output.push(event.data);
    });

    const opened = await firstService.open(cwd, 80, 24);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const shellId = opened.value;

    const written = await firstService.write(shellId, 'echo hi-$((1+2))\r');
    expect(written.ok).toBe(true);
    await until(() => output.join('').includes('hi-3'), 10_000, 'the shell output');

    // Kill the PTY host process itself.
    process.kill(firstPid as number, 'SIGKILL');

    await until(() => exited.some((e) => e.shellId === shellId), 10_000, 'the shell to report exited');
    expect(exited).toContainEqual({ shellId, code: null });
    await until(() => child?.state === 'restarting' || child?.state === 'starting', 5_000, 'the supervisor to notice the death');

    // ENG-07: the first restart is after 1 s; the host reports ready again.
    await until(() => child?.state === 'ready' && child.pid !== null && child.pid !== firstPid, 20_000, 'the PTY host to restart');
    expect(readyCount).toBeGreaterThanOrEqual(2);

    const secondService = child.getService();
    expect(secondService).not.toBeNull();
    if (!secondService) return;
    expect(secondService).not.toBe(firstService);

    const secondOutput: string[] = [];
    secondService.onEvent((event: OrchEvent) => {
      if (event.type === 'shell.output') secondOutput.push(event.data);
    });
    const reopened = await secondService.open(cwd, 80, 24);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const newId: ShellId = reopened.value;
    expect(newId).not.toBe(shellId);

    const rewritten = await secondService.write(newId, 'echo hi-$((4+5))\r');
    expect(rewritten.ok).toBe(true);
    await until(() => secondOutput.join('').includes('hi-9'), 10_000, 'the restarted shell output');

    const closed = await secondService.close(newId);
    expect(closed.ok).toBe(true);
  }, 60_000);
});
