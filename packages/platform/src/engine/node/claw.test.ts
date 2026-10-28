/**
 * Claw 7.5.6 with the orch per-session env patch (ADR 0011, patches/).
 *
 * Starts two Claude sessions with different CLAUDE_CONFIG_DIR values through
 * SessionConfig.env and checks that each child process saw its own value. A
 * fake `claude` script stands in for the real CLI, so no agent or quota is used.
 */
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const FAKE_CLAUDE = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.env.ORCH_TEST_OUT, 'seen-' + process.pid + '.txt'), process.env.CLAUDE_CONFIG_DIR ?? '<unset>');
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-' + process.pid, model: 'fake' }) + '\\n');
process.stdin.resume();
`;

const FAKE_OPENCODE = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const tag = process.env.ORCH_TEST_TAG || ('pid-' + process.pid);
writeFileSync(join(process.env.ORCH_TEST_OUT, 'opencode-args-' + tag + '.json'), JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ type: 'text', part: { id: 'p1', text: 'ok' } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', tokens: { input: 1, output: 1 } } }) + '\\n');
`;

let root = '';
let home = '';
let outDir = '';
let workDir = '';
let dirA = '';
let dirB = '';
let SessionManagerCtor: typeof import('@enderfga/claw-orchestrator').SessionManager;
let fakeClaudeBin = '';
let fakeOpencodeBin = '';

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'orch-claw-'));
  home = path.join(root, 'home');
  outDir = path.join(root, 'seen');
  workDir = path.join(root, 'work');
  dirA = path.join(root, 'acct-a');
  dirB = path.join(root, 'acct-b');
  for (const dir of [home, outDir, workDir, dirA, dirB]) mkdirSync(dir, { recursive: true });
  const fake = path.join(root, 'fake-claude.mjs');
  writeFileSync(fake, FAKE_CLAUDE);
  chmodSync(fake, 0o755);
  fakeClaudeBin = fake;

  const fakeOc = path.join(root, 'fake-opencode.mjs');
  writeFileSync(fakeOc, FAKE_OPENCODE);
  chmodSync(fakeOc, 0o755);
  fakeOpencodeBin = fakeOc;

  // The library reads HOME when it is first imported, so the data folders must
  // be stubbed before the dynamic import below. vi.stubEnv keeps the test free
  // of direct process.env access (lint) and vi.unstubAllEnvs restores it.
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('CLAWO_NO_EMBEDDED_SERVER', '1');
  vi.stubEnv('CLAWO_WF_DIR', path.join(root, 'wf'));
  vi.stubEnv('CLAWO_RUNS_DIR', path.join(root, 'runs'));
  vi.stubEnv('ORCH_TEST_OUT', outDir);
  ({ SessionManager: SessionManagerCtor } = await import('@enderfga/claw-orchestrator'));
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

it.skipIf(process.platform === 'win32')(
  'gives each session its own env and never persists it',
  async () => {
    const manager = new SessionManagerCtor({ claudeBin: fakeClaudeBin, maxConcurrentSessions: 5 });
    try {
      await manager.startSession({
        name: 'acct-a',
        cwd: workDir,
        engine: 'claude',
        permissionMode: 'acceptEdits',
        env: { CLAUDE_CONFIG_DIR: dirA },
      });
      await manager.startSession({
        name: 'acct-b',
        cwd: workDir,
        engine: 'claude',
        permissionMode: 'acceptEdits',
        env: { CLAUDE_CONFIG_DIR: dirB },
      });
    } finally {
      await manager.shutdown();
    }

    const seen = readdirSync(outDir)
      .map((f) => readFileSync(path.join(outDir, f), 'utf8'))
      .sort();
    expect(seen).toEqual([dirA, dirB].sort());

    const registry = readFileSync(path.join(home, '.openclaw', 'claude-sessions.json'), 'utf8');
    expect(registry).toContain('acct-a');
    expect(registry).toContain('acct-b');
    expect(registry).not.toContain(dirA);
    expect(registry).not.toContain(dirB);
    expect(registry).not.toContain('CLAUDE_CONFIG_DIR');
  },
);

it.skipIf(process.platform === 'win32')(
  'adds --standalone to opencode run when standalone is enabled in session env or process env',
  async () => {
    const manager = new SessionManagerCtor({
      claudeBin: fakeClaudeBin,
      engineBins: { opencode: fakeOpencodeBin },
      maxConcurrentSessions: 5,
    });
    try {
      await manager.startSession({
        name: 'oc-standalone',
        cwd: workDir,
        engine: 'opencode',
        permissionMode: 'bypassPermissions',
        env: { ORCH_OPENCODE_STANDALONE: '1', ORCH_TEST_TAG: 'standalone' },
      });
      await manager.sendMessage('oc-standalone', 'hello');

      await manager.startSession({
        name: 'oc-no-standalone',
        cwd: workDir,
        engine: 'opencode',
        permissionMode: 'bypassPermissions',
        env: { ORCH_TEST_TAG: 'no-standalone' },
      });
      await manager.sendMessage('oc-no-standalone', 'hello');

      vi.stubEnv('ORCH_OPENCODE_STANDALONE', '1');
      await manager.startSession({
        name: 'oc-env-standalone',
        cwd: workDir,
        engine: 'opencode',
        permissionMode: 'bypassPermissions',
        env: { ORCH_TEST_TAG: 'env-standalone' },
      });
      await manager.sendMessage('oc-env-standalone', 'hello');
      vi.unstubAllEnvs();
      vi.stubEnv('HOME', home);
      vi.stubEnv('USERPROFILE', home);
      vi.stubEnv('CLAWO_NO_EMBEDDED_SERVER', '1');
      vi.stubEnv('CLAWO_WF_DIR', path.join(root, 'wf'));
      vi.stubEnv('CLAWO_RUNS_DIR', path.join(root, 'runs'));
      vi.stubEnv('ORCH_TEST_OUT', outDir);
    } finally {
      await manager.shutdown();
    }

    const standaloneArgs = JSON.parse(readFileSync(path.join(outDir, 'opencode-args-standalone.json'), 'utf8'));
    expect(standaloneArgs).toContain('--standalone');

    const noStandaloneArgs = JSON.parse(readFileSync(path.join(outDir, 'opencode-args-no-standalone.json'), 'utf8'));
    expect(noStandaloneArgs).not.toContain('--standalone');

    const envStandaloneArgs = JSON.parse(readFileSync(path.join(outDir, 'opencode-args-env-standalone.json'), 'utf8'));
    expect(envStandaloneArgs).toContain('--standalone');
  },
);
