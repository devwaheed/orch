import { describe, expect, it } from 'vitest';
import { createProcessRunners } from './processRunner.js';

const node = process.execPath;
const runners = (baseEnv: Record<string, string> = {}) => createProcessRunners({ baseEnv });

describe('doctor ProcessRunner', () => {
  it('captures stdout and the exit code of a command', async () => {
    const outcome = await runners().doctor.run([node, '-e', "process.stdout.write('hello')"]);
    expect(outcome).toEqual({ kind: 'ran', exitCode: 0, stdout: 'hello', stderr: '' });
  });

  it('reports a non-zero exit as ran, with its exit code and stderr', async () => {
    const outcome = await runners().doctor.run([node, '-e', "process.stderr.write('bad'); process.exit(3)"]);
    expect(outcome).toEqual({ kind: 'ran', exitCode: 3, stdout: '', stderr: 'bad' });
  });

  it('reports a missing command as not_found and never throws', async () => {
    const outcome = await runners().doctor.run(['orch-no-such-command-7f3a']);
    expect(outcome).toEqual({ kind: 'not_found' });
  });

  it('passes arguments as an array, so shell characters are not interpreted', async () => {
    const tricky = 'a b; echo $(whoami) && "x"';
    const outcome = await runners().doctor.run([node, '-e', 'process.stdout.write(process.argv[1])', tricky]);
    expect(outcome).toMatchObject({ kind: 'ran', exitCode: 0, stdout: tricky });
  });

  it('gives the command the base env plus its own env', async () => {
    const outcome = await runners({ A: 'base' }).doctor.run([node, '-e', 'process.stdout.write(JSON.stringify(process.env))'], {
      env: { B: 'extra' },
    });
    expect(outcome.kind).toBe('ran');
    if (outcome.kind === 'ran') expect(JSON.parse(outcome.stdout)).toMatchObject({ A: 'base', B: 'extra' });
  });

  it('uses the given working directory', async () => {
    const outcome = await runners().doctor.run([node, '-e', 'process.stdout.write(process.cwd())'], { cwd: process.cwd() });
    expect(outcome).toMatchObject({ kind: 'ran', exitCode: 0 });
  });
});

describe('accounts IAccountProcessRunner', () => {
  it('returns the exit code and stdout of a captured run', async () => {
    const result = await runners().accounts.run(
      { argv: [node, '-e', "process.stdout.write('signed in')"], env: {} },
      { interactive: false },
    );
    expect(result).toEqual({ exitCode: 0, stdout: 'signed in', stderr: '' });
  });

  it('adds the spec env over the base env', async () => {
    const result = await runners({ A: 'base' }).accounts.run(
      { argv: [node, '-e', "process.stdout.write(process.env.A + process.env.CLAUDE_CONFIG_DIR)"], env: { CLAUDE_CONFIG_DIR: '/p' } },
      { interactive: false },
    );
    expect(result).toEqual({ exitCode: 0, stdout: 'base/p', stderr: '' });
  });

  it('returns the exit code of a failed run', async () => {
    const result = await runners().accounts.run({ argv: [node, '-e', 'process.exit(5)'], env: {} }, { interactive: false });
    expect(result).toEqual({ exitCode: 5, stdout: '', stderr: '' });
  });

  it('runs interactively and reports the exit code with no captured stdout', async () => {
    const result = await runners().accounts.run({ argv: [node, '-e', 'process.exit(0)'], env: {} }, { interactive: true });
    expect(result).toEqual({ exitCode: 0, stdout: '' });
  });

  it('returns null when the command cannot be found', async () => {
    const result = await runners().accounts.run({ argv: ['orch-no-such-command-7f3a'], env: {} }, { interactive: false });
    expect(result).toBeNull();
  });
});
