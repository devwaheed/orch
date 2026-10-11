/**
 * Contract checks: every EngineRequest against the pinned Claw (7.5.6 + patch,
 * ADR 0011), with the fake agent standing in for `claude`. No real agent runs
 * and no quota is spent. Everything lives under a temp folder; the real
 * ~/.orch and ~/.openclaw are never touched.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EngineEvent, EngineRequest, EngineEnv } from '@orch/contracts';
import { EngineClient } from '../common/engineClient.js';
import { createPortPair } from '../test/portPair.js';
import { FAKE_AGENT_SCRIPT_PATH } from '../../adapters/node/fake.js';
import type { EngineHost } from './engineHost.js';
import { serveEngine, type ServedEngine } from './serve.js';

let root = '';
let client: EngineClient;
let host: EngineHost;
let served: ServedEngine;
const events: EngineEvent[] = [];
let workDir = '';
let acctA: EngineEnv;
let acctB: EngineEnv;

const CHECK_PASS = { checks: [{ spec: { type: 'command', cmd: process.execPath, args: ['-e', 'process.exit(0)'] } }] };
const CHECK_FAIL = { checks: [{ spec: { type: 'command', cmd: process.execPath, args: ['-e', 'process.exit(3)'] } }] };

async function call(request: EngineRequest): Promise<Record<string, unknown>> {
  const result = await client.request(request);
  if (!result.ok) throw new Error(`${request.op} failed: ${result.error.code} ${result.error.message}`);
  return (result.value ?? {}) as Record<string, unknown>;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out');
}

async function workflowState(workflow: string): Promise<string> {
  return String((await call({ op: 'workflow.status', workflow })).state);
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'orch-engine-contract-'));
  const home = path.join(root, 'engine', 'home');
  workDir = path.join(root, 'work');
  mkdirSync(workDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  const dirA = path.join(root, 'acct-a');
  const dirB = path.join(root, 'acct-b');
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });
  writeFileSync(path.join(dirA, 'account.json'), JSON.stringify({ emailMasked: 'a•••@example.com', plan: 'pro', signedIn: true }));
  writeFileSync(path.join(dirB, 'account.json'), JSON.stringify({ emailMasked: 'b•••@example.com', plan: 'pro', signedIn: true }));
  acctA = { CLAUDE_CONFIG_DIR: dirA };
  acctB = { CLAUDE_CONFIG_DIR: dirB };

  // Claw reads these when it is first imported, so they are set before createEngineHost.
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('CLAWO_NO_EMBEDDED_SERVER', '1');
  vi.stubEnv('CLAWO_WF_DIR', path.join(root, 'engine', 'wf'));
  vi.stubEnv('CLAWO_RUNS_DIR', path.join(root, 'engine', 'runs'));

  const { createEngineHost } = await import('./engineHost.js');
  host = await createEngineHost({
    engineDir: path.join(root, 'engine'),
    realHome: { HOME: path.join(root, 'real-home') },
    claudeBin: FAKE_AGENT_SCRIPT_PATH,
  });
  const pair = createPortPair();
  served = serveEngine(host, pair.right);
  client = new EngineClient(pair.left);
  client.onEvent((event) => events.push(event));
});

afterAll(async () => {
  served?.close();
  client?.close();
  await host?.dispose();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('engine contract (pinned Claw, fake agent)', () => {
  it('health.ping returns the Claw version and engine.ready carried it', async () => {
    const pong = await call({ op: 'health.ping' });
    expect(typeof pong.engineVersion).toBe('string');
    expect(events).toContainEqual({ type: 'engine.ready', engineVersion: pong.engineVersion });
  });

  let session = '';

  it('session.start with an account env returns a handle', async () => {
    const started = await call({ op: 'session.start', agent: 'claude', cwd: workDir, env: acctA, readOnly: false });
    session = String(started.session);
    expect(session).toMatch(/^s-/);
  });

  it('session.send returns the reply and emits session output and a ledger turn', async () => {
    const reply = await call({ op: 'session.send', session, text: 'say hello' });
    expect(typeof reply.output).toBe('string');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events.some((e) => e.type === 'session.output' && e.session === session)).toBe(true);
    expect(events.some((e) => e.type === 'session.status' && e.session === session && e.status === 'idle')).toBe(true);
  });

  it('session.stop stops the session and reports it', async () => {
    const stopped = await call({ op: 'session.stop', session });
    expect(stopped.stopped).toBe(true);
  });

  it('session.resume re-applies the env it is given and starts the session again', async () => {
    const resumed = await call({ op: 'session.resume', session, env: acctA });
    expect(resumed.session).toBe(session);
    expect(resumed.resumed).toBe(true);
  });

  it('session.handoff starts a new session from the source, on the env it is given', async () => {
    // Claw refuses to hand off a session with no completed exchange in this process (after a resume).
    await call({ op: 'session.send', session, text: 'before handoff' });
    const handed = await call({ op: 'session.handoff', from: session, toAgent: 'claude', env: acctB, cwd: workDir });
    expect(String(handed.session)).toMatch(/^s-/);
    expect(handed.session).not.toBe(session);
  });

  it('ledger.query returns the turns recorded since the given time', async () => {
    const ledger = await call({ op: 'ledger.query', since: '2000-01-01T00:00:00.000Z' });
    expect(Array.isArray(ledger.rows)).toBe(true);
    expect((ledger.rows as Array<{ session: string }>).some((r) => r.session === session)).toBe(true);
  });

  it('verify.run passes a contract whose command exits 0', async () => {
    const bundle = await call({ op: 'verify.run', cwd: workDir, contract: CHECK_PASS });
    expect(bundle.passed).toBe(true);
  });

  it('verify.run fails a contract whose command exits non-zero', async () => {
    const bundle = await call({ op: 'verify.run', cwd: workDir, contract: CHECK_FAIL });
    expect(bundle.passed).toBe(false);
  });

  let solve = '';

  it('workflow.start solve runs to a verdict', async () => {
    const started = await call({
      op: 'workflow.start',
      template: 'solve',
      input: { task: 'do nothing', cwd: workDir, scouts: [{ name: 'scout' }], contract: CHECK_PASS },
      envByNode: { scout: acctA, implement: acctA },
    });
    solve = String(started.workflow);
    await waitFor(async () => ['completed', 'failed', 'cancelled'].includes(await workflowState(solve)));
    expect(await workflowState(solve)).toBe('completed');
    const status = await call({ op: 'workflow.status', workflow: solve });
    expect(status.outcome).toBe('verified');
    expect(events.some((e) => e.type === 'verdict' && e.workflow === solve && e.verdict === 'verified')).toBe(true);
    expect(events.some((e) => e.type === 'workflow.node' && e.workflow === solve && e.node === 'verify')).toBe(true);
  });

  it('workflow.start compare runs a fan-out across 2 agents', async () => {
    const started = await call({
      op: 'workflow.start',
      template: 'compare',
      input: { task: 'compare', cwd: workDir, agents: [{ name: 'one' }, { name: 'two' }] },
      envByNode: { one: acctA, two: acctB },
    });
    const id = String(started.workflow);
    await waitFor(async () => ['completed', 'failed', 'cancelled'].includes(await workflowState(id)));
    expect(await workflowState(id)).toBe('completed');
  });

  it('persists each account env in an owner-only state file, never in the workflow spec', async () => {
    const statePath = path.join(root, 'engine', 'state.json');
    const raw = readFileSync(statePath, 'utf8');
    expect(raw).toContain(acctA.CLAUDE_CONFIG_DIR as string);
    expect(raw).toContain(acctB.CLAUDE_CONFIG_DIR as string);
    if (process.platform !== 'win32') {
      expect(statSync(statePath).mode & 0o777).toBe(0o600);
    }
    const specs = readdirSync(path.join(root, 'engine', 'wf'), { recursive: true }) as string[];
    for (const file of specs.filter((f) => f.endsWith('spec.json'))) {
      expect(readFileSync(path.join(root, 'engine', 'wf', file), 'utf8')).not.toContain('CLAUDE_CONFIG_DIR');
    }
  });

  it('workflow.cancel on a finished workflow reports it was not cancelled', async () => {
    const cancelled = await call({ op: 'workflow.cancel', workflow: solve });
    expect(cancelled.cancelled).toBe(false);
  });

  it('workflow.resume on a finished workflow returns its state', async () => {
    const resumed = await call({ op: 'workflow.resume', workflow: solve });
    expect(resumed.state).toBe('completed');
  });

  it('workflow.start with a missing account for one agent is refused', async () => {
    const result = await client.request({
      op: 'workflow.start',
      template: 'solve',
      input: { task: 'x', cwd: workDir, scouts: [{ name: 'lonely' }] },
      envByNode: { implement: acctA },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } });
  });

  it('workflow.start autoloop is refused until Claw can take an account per role', async () => {
    const result = await client.request({
      op: 'workflow.start',
      template: 'autoloop',
      input: {},
      envByNode: { planner: acctA },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } });
  });

  it('unknown session and workflow ids return not_found', async () => {
    for (const request of [
      { op: 'session.send', session: 's-missing', text: 'x' },
      { op: 'session.stop', session: 's-missing' },
      { op: 'workflow.status', workflow: 'w-missing' },
      { op: 'workflow.cancel', workflow: 'w-missing' },
      { op: 'workflow.resume', workflow: 'w-missing' },
    ] as EngineRequest[]) {
      const result = await client.request(request);
      expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
  });

  it('error messages never name the library', async () => {
    const result = await client.request({ op: 'workflow.status', workflow: 'w-missing' });
    expect(JSON.stringify(result)).not.toMatch(/claw/i);
  });
});
