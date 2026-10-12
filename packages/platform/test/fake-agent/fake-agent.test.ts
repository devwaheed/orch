import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountId } from '@orchagents/contracts';
import {
  createFakeAdapter,
  fakeAdapter,
  FAKE_AGENT_SCRIPT_PATH,
  FakeAgentAdapter,
  spawnFakeAgent,
} from '../../src/adapters/node/fake.js';

describe('Fake Agent Adapter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-fake-adapter-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exports factory functions returning FakeAgentAdapter', () => {
    expect(fs.existsSync(FAKE_AGENT_SCRIPT_PATH)).toBe(true);

    const adapter1 = createFakeAdapter();
    expect(adapter1).toBeInstanceOf(FakeAgentAdapter);
    expect(adapter1.id).toBe('claude');

    const adapter2 = fakeAdapter('codex');
    expect(adapter2.id).toBe('codex');
  });

  it('mirrors ACC-02 accountEnv for each agent', () => {
    const claude = createFakeAdapter('claude');
    expect(claude.accountEnv('/profiles/c1', 'macos')).toEqual({
      CLAUDE_CONFIG_DIR: '/profiles/c1',
    });
    expect(claude.accountSetting).toBe('CLAUDE_CONFIG_DIR');

    const codex = createFakeAdapter('codex');
    expect(codex.accountEnv('/profiles/c2', 'linux')).toEqual({
      CODEX_HOME: '/profiles/c2',
    });
    expect(codex.accountSetting).toBe('CODEX_HOME');

    const gemini = createFakeAdapter('gemini');
    expect(gemini.accountEnv('/profiles/g1', 'macos')).toEqual({
      GEMINI_CLI_HOME: '/profiles/g1',
    });
    expect(gemini.accountSetting).toBe('GEMINI_CLI_HOME');

    const opencode = createFakeAdapter('opencode');
    expect(opencode.accountEnv('/profiles/o1', 'linux')).toEqual({
      XDG_DATA_HOME: '/profiles/o1',
      OPENCODE_CONFIG_DIR: path.join('/profiles/o1', 'config'),
    });
    expect(opencode.accountSetting).toBe('OPENCODE_CONFIG_DIR');

    const agy = createFakeAdapter('agy');
    expect(agy.accountEnv('/profiles/a1', 'macos')).toEqual({
      HOME: '/profiles/a1',
    });
    expect(agy.accountEnv('C:\\profiles\\a1', 'windows')).toEqual({
      USERPROFILE: 'C:\\profiles\\a1',
    });
    expect(agy.accountSetting).toBe('HOME');
  });

  it('reports parallel multi-account support for all operating systems', () => {
    const adapter = createFakeAdapter('claude');
    expect(adapter.supportByOs).toEqual({
      macos: 'parallel',
      linux: 'parallel',
      windows: 'parallel',
    });
  });

  it('prepares profile folder and writes default account', async () => {
    const adapter = createFakeAdapter('claude');
    const profileDir = path.join(tmpDir, 'profile-1');
    await adapter.prepareProfile(profileDir, 'macos');

    const accountFile = path.join(profileDir, 'account.json');
    expect(fs.existsSync(accountFile)).toBe(true);

    const account = JSON.parse(fs.readFileSync(accountFile, 'utf8'));
    expect(account.emailMasked).toBe('f•••@example.com');
    expect(account.plan).toBe('pro');
  });

  it('builds login and whoami CommandSpecs', () => {
    const adapter = createFakeAdapter('claude');
    const profileDir = path.join(tmpDir, 'profile-cmds');

    const loginSpec = adapter.loginCommand(profileDir, 'macos');
    expect(loginSpec.argv).toContain('login');
    expect(loginSpec.cwd).toBe(profileDir);
    expect(loginSpec.env).toEqual({ CLAUDE_CONFIG_DIR: profileDir });

    const whoAmISpec = adapter.whoAmICommand(profileDir, 'macos');
    expect(whoAmISpec).not.toBeNull();
    expect(whoAmISpec!.argv).toContain('whoami');
    expect(whoAmISpec!.cwd).toBe(profileDir);
    expect(whoAmISpec!.env).toEqual({ CLAUDE_CONFIG_DIR: profileDir });
  });

  it('parses whoAmI output correctly', () => {
    const adapter = createFakeAdapter('claude');

    // Human readable text
    expect(adapter.parseWhoAmI('Logged in as f•••@example.com (pro)')).toEqual({
      emailMasked: 'f•••@example.com',
      plan: 'pro',
    });
    expect(adapter.parseWhoAmI('Logged in as u•••@domain.org')).toEqual({
      emailMasked: 'u•••@domain.org',
    });

    // JSON format
    expect(adapter.parseWhoAmI(JSON.stringify({ emailMasked: 't•••@team.com', plan: 'enterprise' }))).toEqual({
      emailMasked: 't•••@team.com',
      plan: 'enterprise',
    });

    // Signed out cases
    expect(adapter.parseWhoAmI('Not logged in')).toBeNull();
    expect(adapter.parseWhoAmI('')).toBeNull();
    expect(adapter.parseWhoAmI('Some unexpected error')).toBeNull();
  });

  it('parses fake limit output lines into QuotaObservation', () => {
    const adapter = createFakeAdapter('claude');
    const accountId = 'claude-main' as AccountId;

    const line = 'Rate limit reached. Resets at 2026-10-11T16:00:00.000Z (window: 5h, used: 100%)';
    const observation = adapter.parseQuotaSignal(accountId, line);

    expect(observation).not.toBeNull();
    expect(observation!.accountId).toBe(accountId);
    expect(observation!.limited).toBe(true);
    expect(observation!.resetsAt).toBe('2026-10-11T16:00:00.000Z');
    expect(observation!.window).toBe('5h');
    expect(observation!.usedPct).toBe(100);
    expect(observation!.source).toBe('reported');
    expect(observation!.raw).toBe(line);

    // Non-limit lines return null
    expect(adapter.parseQuotaSignal(accountId, 'Task completed normally')).toBeNull();
  });

  it('returns shared skills and profile skills paths', () => {
    const adapter = createFakeAdapter('claude');
    expect(adapter.sharedSkillsDir('/home/user', 'macos')).toBe(path.join('/home/user', '.claude', 'skills'));
    expect(adapter.profileSkillsDir('/profiles/claude-1', 'macos')).toBe(path.join('/profiles/claude-1', 'skills'));
  });
});

describe('Fake Agent CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-fake-agent-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runCLI(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawnFakeAgent(args, {
        cwd: tmpDir,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (d) => {
        stdout += d.toString();
      });
      proc.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('close', (code) => {
        resolve({ code: code ?? 0, stdout, stderr });
      });
      proc.on('error', reject);
    });
  }

  it('outputs version on --version', async () => {
    const res = await runCLI(['--version']);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('1.0.0');
  });

  it('handles whoami when signed out', async () => {
    const res = await runCLI(['whoami'], { FAKE_AGENT_CONFIG_DIR: tmpDir });
    expect(res.code).toBe(1);
    expect(res.stdout.trim()).toBe('Not logged in');
  });

  it('handles login and subsequent whoami', async () => {
    const loginRes = await runCLI(['login'], {
      FAKE_AGENT_CONFIG_DIR: tmpDir,
      FAKE_AGENT_EMAIL_MASKED: 't•••@acme.dev',
      FAKE_AGENT_PLAN: 'team',
    });
    expect(loginRes.code).toBe(0);
    expect(loginRes.stdout).toContain('Logged in as t•••@acme.dev (team)');

    const whoamiRes = await runCLI(['whoami'], { FAKE_AGENT_CONFIG_DIR: tmpDir });
    expect(whoamiRes.code).toBe(0);
    expect(whoamiRes.stdout).toContain('Logged in as t•••@acme.dev (team)');
  });

  it('handles logout', async () => {
    await runCLI(['login'], { FAKE_AGENT_CONFIG_DIR: tmpDir });
    const logoutRes = await runCLI(['logout'], { FAKE_AGENT_CONFIG_DIR: tmpDir });
    expect(logoutRes.code).toBe(0);
    expect(logoutRes.stdout).toContain('Logged out');

    const whoamiRes = await runCLI(['whoami'], { FAKE_AGENT_CONFIG_DIR: tmpDir });
    expect(whoamiRes.code).toBe(1);
  });

  it('runs plain CLI with default succeed scenario', async () => {
    const res = await runCLI(['test task'], { FAKE_AGENT_CONFIG_DIR: tmpDir });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Task completed successfully');
  });

  it('runs plain CLI with echo_account scenario', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fake-agent.json'),
      JSON.stringify({ scenario: 'echo_account' }),
      'utf8',
    );
    const res = await runCLI(['check account'], {
      FAKE_AGENT_CONFIG_DIR: tmpDir,
      CLAUDE_CONFIG_DIR: '/custom/claude/profile',
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('CLAUDE_CONFIG_DIR=/custom/claude/profile');
  });

  it('runs plain CLI with crash scenario', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fake-agent.json'),
      JSON.stringify({ scenario: 'crash', exitCode: 42, errorMessage: 'intentional crash' }),
      'utf8',
    );
    const res = await runCLI(['will crash'], { FAKE_AGENT_CONFIG_DIR: tmpDir });
    expect(res.code).toBe(42);
    expect(res.stderr).toContain('intentional crash');
  });

  it('runs Codex one-shot exec --json protocol', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fake-agent.json'),
      JSON.stringify({
        scenario: 'edit_files',
        files: [{ path: 'generated.txt', content: 'Codex output' }],
      }),
      'utf8',
    );

    const res = await runCLI(['exec', '--sandbox', 'workspace-write', '--json', 'create file'], {
      FAKE_AGENT_CONFIG_DIR: tmpDir,
    });
    expect(res.code).toBe(0);

    const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l) as { type?: string; item?: { type?: string } });
    expect(lines[0]?.type).toBe('thread.started');
    expect(lines[1]?.type).toBe('item.completed');
    expect(lines[1]?.item?.type).toBe('agent_message');
    expect(lines[2]?.type).toBe('turn.completed');

    expect(fs.readFileSync(path.join(tmpDir, 'generated.txt'), 'utf8')).toBe('Codex output');
  });

  it('runs Codex one-shot exec limit scenario', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fake-agent.json'),
      JSON.stringify({
        scenario: 'limit',
        resetsAt: '2026-10-11T18:00:00.000Z',
        window: '5h',
      }),
      'utf8',
    );

    const res = await runCLI(['exec', '--json', 'check limit'], {
      FAKE_AGENT_CONFIG_DIR: tmpDir,
    });
    expect(res.code).toBe(0);

    const lines = res.stdout.trim().split('\n');
    expect(lines[0]).toBe('{"type":"thread.started","thread_id":"fake-codex-thread-1"}');
    expect(lines[1]).toContain('Rate limit reached. Resets at 2026-10-11T18:00:00.000Z');
    const failedEvent = JSON.parse(lines[2] ?? '{}') as { type?: string; error?: { message?: string } };
    expect(failedEvent.type).toBe('turn.failed');
    expect(failedEvent.error?.message).toContain('2026-10-11T18:00:00.000Z');
  });
});

describe('Claw Orchestrator stream-json Protocol Driver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-fake-claw-driver-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper that drives a session the way Claw's PersistentSession does
  function startStreamSession(env: NodeJS.ProcessEnv = {}) {
    const proc = spawnFakeAgent(
      [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--session-id',
        'session-test-42',
      ],
      {
        cwd: tmpDir,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    if (!proc.stdout || !proc.stdin) {
      throw new Error('Child process stdio streams not available');
    }
    const stdout = proc.stdout;
    const stdin = proc.stdin;

    const rl = readline.createInterface({ input: stdout, crlfDelay: Infinity });
    const events: Array<Record<string, unknown>> = [];
    const rawLines: string[] = [];
    let onEventCallback: ((event: Record<string, unknown>) => void) | null = null;

    rl.on('line', (line) => {
      rawLines.push(line);
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        events.push(parsed);
        if (onEventCallback) onEventCallback(parsed);
      } catch {
        // raw non-json line
      }
    });

    const waitForEvent = (predicate: (e: Record<string, unknown>) => boolean, timeoutMs = 2000): Promise<Record<string, unknown>> => {
      return new Promise((resolve, reject) => {
        const existing = events.find(predicate);
        if (existing) return resolve(existing);

        const timer = setTimeout(() => {
          onEventCallback = null;
          reject(new Error(`Timeout waiting for event. Seen ${events.length} events.`));
        }, timeoutMs);

        onEventCallback = (ev) => {
          if (predicate(ev)) {
            clearTimeout(timer);
            onEventCallback = null;
            resolve(ev);
          }
        };
      });
    };

    const sendUserMessage = (text: string, uuid: string) => {
      const payload = {
        type: 'user',
        uuid,
        message: {
          role: 'user',
          content: [{ type: 'text', text }],
        },
      };
      stdin.write(JSON.stringify(payload) + '\n');
    };

    return { proc, events, rawLines, waitForEvent, sendUserMessage };
  }

  it('speaks Claude stream-json init and turn completion (succeed)', async () => {
    const session = startStreamSession({ FAKE_AGENT_CONFIG_DIR: tmpDir });

    // 1. Initial system/init event emitted at startup
    const initEvent = await session.waitForEvent((e) => e.type === 'system' && e.subtype === 'init');
    expect(initEvent.session_id).toBe('session-test-42');

    // 2. Send turn 1
    const uuid1 = 'user-uuid-1';
    session.sendUserMessage('Fix bug', uuid1);

    // 3. Receive result event matching uuid
    const resultEvent = await session.waitForEvent(
      (e) => e.type === 'result' && Array.isArray(e.user_message_uuids) && (e.user_message_uuids as string[]).includes(uuid1),
    );
    expect(resultEvent.result).toContain('Task completed successfully');
    expect(resultEvent.stop_reason).toBeUndefined();

    session.proc.kill('SIGTERM');
  });

  it('drives edit_files scenario in stream-json mode', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fake-agent.json'),
      JSON.stringify({
        scenario: 'edit_files',
        files: [
          { path: 'src/main.js', content: 'console.log("hello world");' },
          { path: 'README.md', content: '# Tested' },
        ],
      }),
      'utf8',
    );

    const session = startStreamSession({ FAKE_AGENT_CONFIG_DIR: tmpDir });
    await session.waitForEvent((e) => e.type === 'system');

    const uuid = 'turn-edit-files';
    session.sendUserMessage('Please create files', uuid);

    await session.waitForEvent((e) => e.type === 'result' && (e.user_message_uuids as string[]).includes(uuid));

    expect(fs.readFileSync(path.join(tmpDir, 'src/main.js'), 'utf8')).toBe('console.log("hello world");');
    expect(fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8')).toBe('# Tested');

    session.proc.kill('SIGTERM');
  });

  it('drives fail_tests scenario in stream-json mode', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fake-agent.json'),
      JSON.stringify({
        scenario: 'fail_tests',
        files: [{ path: 'test.txt', content: 'FAILING_CHECK' }],
      }),
      'utf8',
    );

    const session = startStreamSession({ FAKE_AGENT_CONFIG_DIR: tmpDir });
    await session.waitForEvent((e) => e.type === 'system');

    const uuid = 'turn-fail-test';
    session.sendUserMessage('Break tests', uuid);

    await session.waitForEvent((e) => e.type === 'result' && (e.user_message_uuids as string[]).includes(uuid));
    expect(fs.readFileSync(path.join(tmpDir, 'test.txt'), 'utf8')).toBe('FAILING_CHECK');

    session.proc.kill('SIGTERM');
  });

  it('drives limit scenario with quota signal parsing', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fake-agent.json'),
      JSON.stringify({
        scenario: 'limit',
        resetsAt: '2026-10-11T20:00:00.000Z',
        window: '5h',
        usedPct: 100,
      }),
      'utf8',
    );

    const session = startStreamSession({ FAKE_AGENT_CONFIG_DIR: tmpDir });
    await session.waitForEvent((e) => e.type === 'system');

    const uuid = 'turn-limit';
    session.sendUserMessage('Do work', uuid);

    const result = await session.waitForEvent((e) => e.type === 'result' && (e.user_message_uuids as string[]).includes(uuid));
    expect(result.stop_reason).toBe('rate_limit');
    expect(result.is_error).toBe(true);

    // Assert raw limit line was emitted
    const limitLine = session.rawLines.find((l) => l.includes('Rate limit reached'));
    expect(limitLine).toBeDefined();

    // Verify adapter parses it
    const adapter = createFakeAdapter();
    const observation = adapter.parseQuotaSignal('claude-test' as AccountId, limitLine!);
    expect(observation).not.toBeNull();
    expect(observation!.limited).toBe(true);
    expect(observation!.resetsAt).toBe('2026-10-11T20:00:00.000Z');
    expect(observation!.window).toBe('5h');

    session.proc.kill('SIGTERM');
  });

  it('drives echo_account scenario in stream-json mode', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fake-agent.json'),
      JSON.stringify({ scenario: 'echo_account' }),
      'utf8',
    );

    const session = startStreamSession({
      FAKE_AGENT_CONFIG_DIR: tmpDir,
      CLAUDE_CONFIG_DIR: '/my/custom/claude/dir',
    });
    await session.waitForEvent((e) => e.type === 'system');

    const uuid = 'turn-echo';
    session.sendUserMessage('who are you', uuid);

    const result = await session.waitForEvent((e) => e.type === 'result' && (e.user_message_uuids as string[]).includes(uuid));
    expect(result.result).toContain('CLAUDE_CONFIG_DIR=/my/custom/claude/dir');

    session.proc.kill('SIGTERM');
  });

  it('drives crash scenario in stream-json mode', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fake-agent.json'),
      JSON.stringify({ scenario: 'crash', exitCode: 7, errorMessage: 'turn crash' }),
      'utf8',
    );

    const session = startStreamSession({ FAKE_AGENT_CONFIG_DIR: tmpDir });
    await session.waitForEvent((e) => e.type === 'system');

    const exitPromise = new Promise<{ code: number | null }>((resolve) => {
      session.proc.on('close', (code) => resolve({ code }));
    });

    session.sendUserMessage('trigger crash', 'uuid-crash');

    const { code } = await exitPromise;
    expect(code).toBe(7);
  });

  it('drives hang scenario in stream-json mode (does not reply)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fake-agent.json'),
      JSON.stringify({ scenario: 'hang' }),
      'utf8',
    );

    const session = startStreamSession({ FAKE_AGENT_CONFIG_DIR: tmpDir });
    await session.waitForEvent((e) => e.type === 'system');

    session.sendUserMessage('hang now', 'uuid-hang');

    // Wait 250ms and assert no result event arrives
    await new Promise((r) => setTimeout(r, 250));
    const hasResult = session.events.some((e) => e.type === 'result');
    expect(hasResult).toBe(false);

    session.proc.kill('SIGTERM');
  });

  it('supports multi-turn scripts with turns array', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'fake-agent.json'),
      JSON.stringify({
        turns: [
          { scenario: 'succeed', response: 'First turn passed' },
          { scenario: 'limit', resetsAt: '2026-10-11T23:00:00.000Z', window: 'daily' },
        ],
      }),
      'utf8',
    );

    const session = startStreamSession({ FAKE_AGENT_CONFIG_DIR: tmpDir });
    await session.waitForEvent((e) => e.type === 'system');

    // Turn 1
    session.sendUserMessage('Turn 1', 'uuid-turn-1');
    const r1 = await session.waitForEvent((e) => e.type === 'result' && (e.user_message_uuids as string[]).includes('uuid-turn-1'));
    expect(r1.result).toBe('First turn passed');

    // Turn 2
    session.sendUserMessage('Turn 2', 'uuid-turn-2');
    const r2 = await session.waitForEvent((e) => e.type === 'result' && (e.user_message_uuids as string[]).includes('uuid-turn-2'));
    expect(r2.stop_reason).toBe('rate_limit');
    expect(r2.result).toContain('2026-10-11T23:00:00.000Z');

    session.proc.kill('SIGTERM');
  });
});
