/**
 * Account routing for the internal sessions Claw starts on its own: council
 * members, the fix-on-red fixer, and the autoloop Planner. Every spawn is
 * recorded by a logging wrapper around the fake agent, so each child process
 * shows the CLAUDE_CONFIG_DIR it was given. No real agent runs, no quota is spent.
 */
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EngineEnv, EngineEvent } from '@orch/contracts';
import { EngineClient } from '../common/engineClient.js';
import { createPortPair } from '../test/portPair.js';
import { FAKE_AGENT_SCRIPT_PATH } from '../../adapters/node/fake.js';
import type { EngineHost } from './engineHost.js';
import { serveEngine, type ServedEngine } from './serve.js';

interface Spawn {
  bin: string;
  config: string | null;
  cwd: string;
  args: string[];
}

const CONSENSUS_OK = { scenario: 'succeed', response: '[CONSENSUS: YES] Agreed.' };
const CHECK_NEEDS_FIX = {
  id: 'needs-fix',
  checks: [
    {
      spec: {
        type: 'command',
        cmd: process.execPath,
        args: ['-e', "process.exit(require('node:fs').existsSync('fixed.txt') ? 0 : 3)"],
      },
    },
  ],
  fixOnFailureRounds: 1,
};

let root = '';
let workDir = '';
let logPath = '';
let acctA: EngineEnv;
let acctB: EngineEnv;
let acctC: EngineEnv;
let host: EngineHost;
let served: ServedEngine;
let client: EngineClient;
const events: EngineEvent[] = [];

function writeAccount(dir: string, scenario: Record<string, unknown>): EngineEnv {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'fake-agent.json'), JSON.stringify(scenario));
  writeFileSync(path.join(dir, 'account.json'), JSON.stringify({ emailMasked: 'x•••@example.com', plan: 'pro', signedIn: true }));
  return { CLAUDE_CONFIG_DIR: dir };
}

function spawns(): Spawn[] {
  try {
    return readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Spawn);
  } catch {
    return [];
  }
}

function configDirs(): Array<string | null> {
  return spawns()
    .filter((s) => s.bin === 'claude')
    .map((s) => s.config);
}

async function call(request: Parameters<EngineClient['request']>[0]): Promise<Record<string, unknown>> {
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

const TERMINAL = ['completed', 'failed', 'cancelled'];

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'orch-engine-env-'));
  workDir = path.join(root, 'work');
  logPath = path.join(root, 'spawns.jsonl');
  const home = path.join(root, 'engine', 'home');
  mkdirSync(workDir, { recursive: true });
  mkdirSync(home, { recursive: true });

  acctA = writeAccount(path.join(root, 'acct-a'), CONSENSUS_OK);
  acctB = writeAccount(path.join(root, 'acct-b'), { scenario: 'succeed', response: '[CONSENSUS: YES] B agrees.' });
  acctC = writeAccount(path.join(root, 'acct-c'), { scenario: 'succeed' });

  // Wrappers record each spawn's account env, then run the fake agent (claude) or exit (codex).
  const claudeWrapper = path.join(root, 'claude-wrapper.mjs');
  writeFileSync(
    claudeWrapper,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.ORCH_TEST_SPAWN_LOG, JSON.stringify({ bin: 'claude', config: process.env.CLAUDE_CONFIG_DIR ?? null, cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
await import(${JSON.stringify(pathToFileURL(FAKE_AGENT_SCRIPT_PATH).href)});
`,
  );
  const codexWrapper = path.join(root, 'codex-wrapper.mjs');
  writeFileSync(
    codexWrapper,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.ORCH_TEST_SPAWN_LOG, JSON.stringify({ bin: 'codex', config: process.env.CODEX_HOME ?? null, cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
process.exit(0);
`,
  );
  chmodSync(claudeWrapper, 0o755);
  chmodSync(codexWrapper, 0o755);

  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('CLAWO_NO_EMBEDDED_SERVER', '1');
  vi.stubEnv('CLAWO_WF_DIR', path.join(root, 'engine', 'wf'));
  vi.stubEnv('CLAWO_RUNS_DIR', path.join(root, 'engine', 'runs'));
  vi.stubEnv('ORCH_TEST_SPAWN_LOG', logPath);

  const { createEngineHost } = await import('./engineHost.js');
  host = await createEngineHost({
    engineDir: path.join(root, 'engine'),
    realHome: { HOME: path.join(root, 'real-home') },
    claudeBin: claudeWrapper,
    agentBins: { codex: codexWrapper },
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

describe.skipIf(process.platform === 'win32')('engine routes Claw-started sessions to the right account', () => {
  it('council: each member starts on its own account', async () => {
    const started = await call({
      op: 'workflow.start',
      template: 'council',
      input: {
        task: 'Pick a name.',
        cwd: workDir,
        maxRounds: 1,
        agents: [{ name: 'one' }, { name: 'two' }],
      },
      envByNode: { one: acctA, two: acctB },
    });
    const id = String(started.workflow);
    await waitFor(async () => TERMINAL.includes(await workflowState(id)));
    expect(await workflowState(id)).toBe('completed');
    const dirs = configDirs();
    expect(dirs).toContain(acctA.CLAUDE_CONFIG_DIR);
    expect(dirs).toContain(acctB.CLAUDE_CONFIG_DIR);
    expect(dirs).not.toContain(null);
  });

  it('autoloop: the Planner starts on its own account and nothing starts without one', async () => {
    const before = configDirs().length;
    const started = await call({
      op: 'workflow.start',
      template: 'autoloop',
      input: { cwd: workDir, plannerEngine: 'claude', coderEngine: 'claude', reviewerEngine: 'claude' },
      envByNode: { planner: acctC, coder: acctA, reviewer: acctB },
    });
    const id = String(started.workflow);
    const planned = configDirs().slice(before);
    expect(planned).toContain(acctC.CLAUDE_CONFIG_DIR);
    expect(planned).not.toContain(null);
    expect(await workflowState(id)).not.toBe('failed');
    await call({ op: 'workflow.cancel', workflow: id });
  });

  it('fix-on-red: the fixer runs on the account of the implementer it repairs', async () => {
    const before = configDirs().length;
    const started = await call({
      op: 'workflow.start',
      template: 'solve',
      input: { task: 'make the check pass', cwd: workDir, scouts: [{ name: 'scout' }], contract: CHECK_NEEDS_FIX, maxRepairs: 0 },
      envByNode: { scout: acctB, implement: acctA },
    });
    const id = String(started.workflow);
    await waitFor(async () => TERMINAL.includes(await workflowState(id)));
    const later = configDirs().slice(before);
    // The scout (acct B), the implementer (acct A) and the fixer (acct A) all spawn with an account.
    expect(later.filter((dir) => dir === acctA.CLAUDE_CONFIG_DIR)).toHaveLength(2);
    expect(later).not.toContain(null);
    expect((await call({ op: 'workflow.status', workflow: id })).outcome).toBe('refuted');
  });

  it('agent binaries from the host options are used for that agent', async () => {
    const started = await call({ op: 'session.start', agent: 'codex', cwd: workDir, env: acctB, readOnly: false });
    // The codex wrapper exits at once, so the reply is an error. The spawn is what matters.
    await client.request({ op: 'session.send', session: String(started.session), text: 'hello' });
    const codex = spawns().filter((s) => s.bin === 'codex');
    expect(codex.length).toBeGreaterThan(0);
    expect(codex[0]?.args[0]).toBe('exec');
  });

  it('never writes an account env into a workflow spec or run record', () => {
    const roots = [path.join(root, 'engine', 'wf'), path.join(root, 'engine', 'runs')];
    const files: string[] = [];
    for (const dir of roots) {
      try {
        for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
          if (entry.endsWith('.json') || entry.endsWith('.jsonl')) files.push(path.join(dir, entry));
        }
      } catch {
        // a missing folder has nothing to leak
      }
    }
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const acct of [acctA, acctB, acctC]) {
        expect(text).not.toContain(acct.CLAUDE_CONFIG_DIR as string);
      }
    }
  });
});
