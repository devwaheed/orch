/**
 * Kill-the-host test (S1-11). The engine host runs as a real child process
 * (the Node entry, with IPC). The test starts a workflow, kills the child while
 * the run is in flight, starts a new child on the same folder, and checks the
 * workflow resumes on its persisted account and finishes.
 *
 * Uses the fake agent (no real agent, no quota). Everything lives in a temp
 * folder; ~/.orch and ~/.openclaw are never touched.
 *
 * Skipped on Windows: the kill and the check command are POSIX-tested only so far.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { type ChildProcess, fork } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type EngineRequest } from '@orch/contracts';
import { type EnginePort, EngineClient } from '@orch/platform/src/engine/common/engineClient.js';
import { FAKE_AGENT_SCRIPT_PATH } from '@orch/platform/src/adapters/node/fake.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(here, 'engineHost.ts');
const LOADER = pathToFileURL(path.resolve(here, '../../test/support/ts-loader.mjs')).href;

let root = '';
let engineDir = '';
let acct = '';
const children: ChildProcess[] = [];

function startChild(): { child: ChildProcess; client: EngineClient } {
  const child = fork(ENTRY, ['--engine-dir', engineDir, '--claude-bin', FAKE_AGENT_SCRIPT_PATH], {
    execArgv: ['--import', LOADER],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  children.push(child);
  const port: EnginePort = {
    postMessage: (message) => {
      child.send(message as object);
    },
    on: (_event, listener) => {
      child.on('message', listener);
      return undefined;
    },
  };
  return { child, client: new EngineClient(port) };
}

async function call(client: EngineClient, request: EngineRequest): Promise<Record<string, unknown>> {
  const result = await client.request(request);
  if (!result.ok) throw new Error(`${request.op}: ${result.error.code} ${result.error.message}`);
  return (result.value ?? {}) as Record<string, unknown>;
}

async function until(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for the engine');
}

const HOLD = 'setTimeout(() => process.exit(0), 6000)';

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'orch-engine-kill-'));
  engineDir = path.join(root, 'engine');
  acct = path.join(root, 'acct-a');
  mkdirSync(acct, { recursive: true });
  writeFileSync(path.join(acct, 'account.json'), JSON.stringify({ emailMasked: 'a•••@example.com', plan: 'pro', signedIn: true }));
});

afterAll(() => {
  for (const child of children) child.kill('SIGKILL');
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('engine host child process', () => {
  it('rejects a non-allowlisted env from a real child process', async () => {
    const { client } = startChild();
    await until(async () => (await client.ping()).ok, 30_000);
    const rejected = await client.request({
      op: 'session.start',
      agent: 'claude',
      cwd: root,
      env: { ANTHROPIC_API_KEY: 'sk-not-allowed' } as unknown as { CLAUDE_CONFIG_DIR: string },
      readOnly: false,
    });
    expect(rejected).toMatchObject({ ok: false, error: { code: 'validation_failed' } });
    client.close();
  }, 60_000);

  it('resumes a workflow on the same account after the host is killed', async () => {
    const first = startChild();
    await until(async () => (await first.client.ping()).ok, 30_000);

    const started = await call(first.client, {
      op: 'workflow.start',
      template: 'solve',
      input: {
        task: 'hold the run open',
        cwd: root,
        scouts: [{ name: 'scout' }],
        contract: { checks: [{ spec: { type: 'command', cmd: process.execPath, args: ['-e', HOLD] } }] },
      },
      envByNode: { scout: { CLAUDE_CONFIG_DIR: acct }, implement: { CLAUDE_CONFIG_DIR: acct } },
    });
    const workflow = String(started.workflow);

    await until(async () => (await call(first.client, { op: 'workflow.status', workflow })).state === 'verifying', 60_000);
    first.child.kill('SIGKILL');
    await until(async () => first.child.exitCode !== null || first.child.signalCode !== null, 10_000);
    first.client.close();

    const second = startChild();
    await until(async () => (await second.client.ping()).ok, 30_000);
    await until(async () => {
      const state = (await call(second.client, { op: 'workflow.status', workflow })).state;
      return state === 'completed' || state === 'failed';
    }, 90_000);

    const status = await call(second.client, { op: 'workflow.status', workflow });
    expect(status.state).toBe('completed');
    expect(status.outcome).toBe('verified');
    second.client.close();
  }, 180_000);
});
