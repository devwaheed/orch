/**
 * Walking skeleton (S1-17, phase 1 gate).
 *
 * The whole single-mode chain, with the fake agent and no real agent or quota:
 *   core host (in-process, real services, real socket)
 *     -> engine host child process (real Claw, fake claude binary)
 *   orch CLI (spawned node process, talks to the socket only)
 *
 * Steps: add two fake Claude accounts with `orch accounts add`, route away from
 * the first one with the real accounts API (use: false), run
 * `orch run "fix the failing test" --check "npm test"` from a temp git repo whose
 * test fails until the fake agent edits the source, then check that the job ran
 * on the second account, the verdict is verified, and `orch ps` shows the run.
 *
 * Everything lives in a temp HOME. The real ~/.orch is never touched: the core
 * host gets the temp home, and the CLI gets HOME (USERPROFILE on Windows) set to it.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Account, AccountId, IAccountsService, IJobsService, IRunsService, Job, JobId, OrchEvent, Run, Session } from '@orchagents/contracts';
import type { CommandSpec, Os, Result } from '@orchagents/contracts';
import { ChannelClient } from '@orchagents/platform/channels/common';
import { createSocketClientTransport } from '@orchagents/platform/channels/node';
import { FAKE_AGENT_SCRIPT_PATH, FakeAgentAdapter } from '@orchagents/platform/src/adapters/node/fake.js';
import { runGit } from '@orchagents/platform/src/git/node/gitService.js';
import { CHANNEL_SCHEMAS } from '../../src/node/channelSchemas.js';
import { startCoreHost, type RunningCoreHost } from '../../src/node/coreHostMain.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The engine host entry, run from TypeScript through the test loader (see test/support). */
const ENGINE_ENTRY = path.resolve(here, '../../src/node/engineHost.ts');
const CLI_ENTRY = path.resolve(here, '../../../cli/src/node/bin.ts');
const LOADER_URL = pathToFileURL(path.resolve(here, '../support/ts-transpile-register.mjs')).href;

/**
 * Windows: the fake adapter spawns the fake agent's `.cmd` shim directly, and Node
 * refuses to spawn a `.cmd` file without a shell (EINVAL). The job integration test
 * (jobsService.test.ts) skips Windows for the same reason, so the skeleton does too.
 */
const SKIP_ON_WINDOWS = process.platform === 'win32';

const FIRST_NAME = 'Work';
const SECOND_NAME = 'Backup';
const RUN_TIMEOUT_MS = 180_000;

let home = '';
let repo = '';
let host: RunningCoreHost | null = null;
let client: ChannelClient | null = null;
let accounts: IAccountsService;
let jobs: IJobsService;
let runs: IRunsService;
const events: OrchEvent[] = [];

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the real CLI entry in a child process. HOME is the temp home, so the CLI finds the socket and token there. */
function orch(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', LOADER_URL, CLI_ENTRY, ...args], {
      cwd: repo,
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function cliEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: home,
    USERPROFILE: home,
  };
}

async function waitFor(description: string, check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${description}`);
}

function ok<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.message} ${result.error.fix ?? ''}`.trim());
  return result.value;
}

/**
 * The fake agent's login always reports the same masked email, and engine-style env
 * filtering drops any per-account variable that could change it. Two accounts that
 * look identical fail the isolation check (ACC-04, fail-safe). So this fake's login
 * writes its own profile's account.json, with a masked email taken from the slug.
 * The fake's whoami still reads that file, and the login stays non-interactive.
 */
class NamedAccountFake extends FakeAgentAdapter {
  override loginCommand(profileDir: string, os: Os): CommandSpec {
    const slug = path.basename(profileDir).replace(/^claude-/, '');
    const accountFile = path.join(profileDir, 'account.json');
    const account = { emailMasked: `${slug.charAt(0)}•••@example.com`, plan: 'pro', signedIn: true };
    const script = `require('node:fs').writeFileSync(${JSON.stringify(accountFile)}, ${JSON.stringify(JSON.stringify(account))}); console.log('Logged in');`;
    return { argv: [process.execPath, '-e', script], env: this.accountEnv(profileDir, os), cwd: profileDir };
  }
}

/** A fake Claude account's config folder: the fake agent reads fake-agent.json from here. */
function profileDir(accountId: AccountId): string {
  return path.join(home, '.orch', 'profiles', accountId);
}

function writeScenario(accountId: AccountId, scenario: Record<string, unknown>): void {
  writeFileSync(path.join(profileDir(accountId), 'fake-agent.json'), JSON.stringify(scenario), 'utf8');
}

beforeAll(async () => {
  home = mkdtempSync(path.join(tmpdir(), 'orch-skel-'));
  repo = path.join(home, 'repo');
  if (SKIP_ON_WINDOWS) return;

  // A git repo whose test fails until src/sum.js is fixed. check.js is the test; the
  // fake agent's edit_files scenario writes the fix.
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', private: true, scripts: { test: 'node check.js' } }, null, 2) + '\n');
  writeFileSync(path.join(repo, 'check.js'), "const { add } = require('./src/sum.js');\nif (add(2, 3) !== 5) {\n  console.error('add(2, 3) should be 5');\n  process.exit(1);\n}\n");
  writeFileSync(path.join(repo, 'src', 'sum.js'), 'module.exports = { add: (a, b) => a - b };\n');
  await runGit(['init', '-b', 'main', repo]);
  await runGit(['-C', repo, 'config', 'user.name', 'Test']);
  await runGit(['-C', repo, 'config', 'user.email', 'test@example.com']);
  await runGit(['-C', repo, 'add', '.']);
  await runGit(['-C', repo, 'commit', '-m', 'Initial commit']);

  host = await startCoreHost({
    home,
    baseEnv: cliEnv(),
    adapters: [new NamedAccountFake('claude')],
    engine: {
      entry: ENGINE_ENTRY,
      args: ['--claude-bin', FAKE_AGENT_SCRIPT_PATH],
      execArgv: ['--import', LOADER_URL],
    },
    measureFreeBytes: async () => 1,
  });

  const token = readFileSync(host.tokenPath, 'utf8').trim();
  const transport = await createSocketClientTransport({ socketPath: host.socketPath, token });
  client = new ChannelClient(transport);
  accounts = client.getService<IAccountsService>('accounts', CHANNEL_SCHEMAS.accounts);
  jobs = client.getService<IJobsService>('jobs', CHANNEL_SCHEMAS.jobs);
  runs = client.getService<IRunsService>('runs', CHANNEL_SCHEMAS.runs);
  const eventsService = client.getService<{ subscribe(listener: (event: OrchEvent) => void): () => void }>('events');
  eventsService.subscribe((event) => events.push(event));
}, 60_000);

afterAll(async () => {
  client?.dispose();
  await host?.dispose();
  rmSync(home, { recursive: true, force: true });
});

describe.skipIf(SKIP_ON_WINDOWS)('walking skeleton: orch run on the second account (phase 1 gate)', () => {
  it('starts the engine, adds two fake accounts, runs the job on the second account, and verifies it', async () => {
    // The engine is a child process: wait until it reports ready before any job starts.
    await waitFor('the engine to be ready', async () => events.some((e) => e.type === 'engine.health' && e.state === 'ready'), 60_000);

    // 1. Add two fake Claude accounts through the real CLI.
    const addFirst = await orch(['accounts', 'add', 'claude', FIRST_NAME]);
    expect(addFirst.code, addFirst.stderr || addFirst.stdout).toBe(0);
    expect(addFirst.stdout).toContain('Ready:');
    const addSecond = await orch(['accounts', 'add', 'claude', SECOND_NAME]);
    expect(addSecond.code, addSecond.stderr || addSecond.stdout).toBe(0);
    expect(addSecond.stdout).toContain('Ready:');

    const list = ok(await accounts.list());
    const first = list.find((a: Account) => a.name === FIRST_NAME);
    const second = list.find((a: Account) => a.name === SECOND_NAME);
    expect(first && second).toBeTruthy();
    if (!first || !second) return;

    // 2. Route to the second account: the first one is switched off with the real accounts API.
    ok(await accounts.setUse(first.id, false));

    // 3. The fake agent on the second account fixes the test; the first one does nothing,
    //    so a run on the first account could not verify.
    writeScenario(first.id, { scenario: 'succeed' });
    writeScenario(second.id, {
      scenario: 'edit_files',
      files: [{ path: 'src/sum.js', content: 'module.exports = { add: (a, b) => a + b };\n' }],
    });

    // 4. Run the goal through the real CLI.
    const run = await orch(['run', 'fix the failing test', '--check', 'npm test']);
    expect(run.code, run.stderr || run.stdout).toBe(0);
    const started = /started job (j-[0-9a-z]+)/.exec(run.stdout);
    expect(started, run.stdout).not.toBeNull();
    const jobId = started?.[1] as JobId;

    // 5. Wait for the job to finish. Job status "done" is the verified verdict
    //    (the jobs service sets done only when the verdict is verified, failed when refuted).
    let job: Job | undefined;
    await waitFor(
      `job ${jobId} to finish`,
      async () => {
        const current = await jobs.get(jobId);
        if (!current.ok) return false;
        job = current.value;
        return current.value.status === 'done' || current.value.status === 'failed';
      },
      RUN_TIMEOUT_MS,
    );
    expect(job?.status).toBe('done');

    // 6. The run is on the second account and finished.
    const jobRuns = ok(await runs.list(jobId));
    expect(jobRuns).toHaveLength(1);
    const [finished] = jobRuns as Run[];
    expect(finished?.accountId).toBe(second.id);
    expect(finished?.status).toBe('done');

    // 7. orch ps --json shows the same run on the same account.
    const ps = await orch(['ps', '--json']);
    expect(ps.code, ps.stderr || ps.stdout).toBe(0);
    const psRuns = JSON.parse(ps.stdout) as Run[];
    const psRun = psRuns.find((r) => r.id === finished?.id);
    expect(psRun?.accountId).toBe(second.id);
    expect(psRun?.status).toBe('done');

    // 8. orch ps (table) lists the run with its account and status.
    const table = await orch(['ps']);
    expect(table.code).toBe(0);
    expect(table.stdout).toContain(finished?.id ?? '');
    expect(table.stdout).toContain(`claude@${SECOND_NAME.toLowerCase()}`);
    expect(table.stdout).toContain('done');

    // 9. The fix really landed in the run's worktree.
    const worktree = path.join(repo, '.orch', 'wt', finished?.id ?? '');
    expect(readFileSync(path.join(worktree, 'src', 'sum.js'), 'utf8')).toContain('a + b');

    // 10. orch sessions --json lists the run's session: the job's engine session, on the second account (SES).
    const sessions = await orch(['sessions', '--json']);
    expect(sessions.code, sessions.stderr || sessions.stdout).toBe(0);
    const sessionRows = JSON.parse(sessions.stdout) as Session[];
    const runSession = sessionRows.find((s) => s.runId === finished?.id);
    expect(runSession, sessions.stdout).toMatchObject({ jobId, agent: 'claude', accountId: second.id });
  }, RUN_TIMEOUT_MS + 120_000);
});
