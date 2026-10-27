/**
 * SaaS Factory status: factory-product check, script discovery, output parsing.
 * Tests never run the real factory or read the real home: they build a fake
 * home in a temp folder and inject a fake command runner.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { FactoryStatus, Result } from '@orchagents/contracts';
import { FACTORY_TIMEOUT_MS, findFactoryScript, readFactoryStatus } from './factoryStatus.js';
import type { CommandRunner } from '../../queue/node/specMerge.js';

/** Recorded call of the injected runner. */
interface RunCall {
  cmd: string;
  args: readonly string[];
  options: { cwd?: string; timeoutMs?: number; env?: Readonly<Record<string, string>> };
}

const neverRun: CommandRunner = () => {
  throw new Error('No process must run for a plain project.');
};

/** The status JSON the factory's own script would print, with an extra unknown field. */
const stdoutJson = JSON.stringify({
  product: 'demo',
  path: '.',
  done: false,
  missing: ['docs/05-references.md'],
  next: 'write 05-references.md (saas-design-reference) — run /factory',
  stages: [{ stage: '00-brief', by: 'saas-idea-research', done: true }],
  design: [{ step: '1 shape', done: true }],
  delivery: null,
  fieldTheSchemaDoesNotKnow: 5,
});

let tempRoots: readonly string[] = [];

afterAll(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

describe('specs factory status', () => {
  const track = async (): Promise<string> => {
    const dir = await mkdtemp(path.join(tmpdir(), 'orch-factory-'));
    tempRoots = tempRoots.concat(dir);
    return dir;
  };

  it('returns null for a plain project and never starts a process', async () => {
    const repo = await track();
    const res = await readFactoryStatus(repo, { commandRunner: neverRun, home: repo });
    expect(res).toEqual({ ok: true, value: null });
  });

  it('discovers the installed factory with the highest version and parses the script output', async () => {
    const home = await track();
    const repo = await track();
    await mkdir(path.join(repo, 'docs'), { recursive: true });
    await writeFile(path.join(repo, 'docs', '00-brief.md'), 'brief\n');

    const scriptFor = async (version: string): Promise<string> => {
      const script = path.join(
        home,
        '.claude',
        'plugins',
        'cache',
        'saas-factory',
        'saas-factory',
        version,
        'scripts',
        'factory-status.mjs',
      );
      await mkdir(path.dirname(script), { recursive: true });
      await writeFile(script, '// stub\n');
      return script;
    };

    // An older version whose script must NOT be picked.
    await scriptFor('1.2.0');
    const newest = await scriptFor('1.10.0');

    const calls: RunCall[] = [];
    const runner: CommandRunner = (cmd, args, options) => {
      calls.push({ cmd, args, options });
      if (path.basename(path.dirname(path.dirname(args[0] ?? ''))) === '1.10.0') {
        return Promise.resolve({ exitCode: 0, stdout: stdoutJson, stderr: '' });
      }
      return Promise.resolve({ exitCode: 1, stdout: '', stderr: 'wrong version picked' });
    };

    const res = await readFactoryStatus(repo, { commandRunner: runner, home });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.cmd).toBe(process.execPath);
    expect(call?.args).toEqual([newest, repo, '--json']);
    expect(call?.options.cwd).toBe(repo);
    expect(call?.options.timeoutMs).toBe(FACTORY_TIMEOUT_MS);
    expect(call?.options.env?.ELECTRON_RUN_AS_NODE).toBe('1');

    expect(res.ok).toBe(true);
    if (res.ok) {
      const status = res.value as FactoryStatus;
      expect(status.product).toBe('demo');
      // The unknown field the newer factory prints is stripped by the schema.
      expect(Object.hasOwn(status, 'fieldTheSchemaDoesNotKnow')).toBe(false);
    }
  });

  it('reports not_found with install guidance when the factory is not installed', async () => {
    const home = await track();
    const repo = await track();
    await mkdir(path.join(repo, '.factory'), { recursive: true });

    const calls: RunCall[] = [];
    const runner: CommandRunner = (cmd, args, options) => {
      calls.push({ cmd, args, options });
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
    };

    const res: Result<FactoryStatus | null> = await readFactoryStatus(repo, {
      commandRunner: runner,
      home,
    });

    expect(calls).toHaveLength(0);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('not_found');
      expect(res.error.message).toBe('SaaS Factory isn’t installed.');
      expect(res.error.fix).toBe(
        'Install it with npx github:devwaheed/saas-factory, then reopen the project.',
      );
    }
    // Discovery order is part of the contract: the claude cache wins over codex.
    expect(await findFactoryScript(home)).toBeNull();
  });
});
