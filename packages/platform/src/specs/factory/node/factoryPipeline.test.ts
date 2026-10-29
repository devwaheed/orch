import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fixture from '../../../../../contracts/src/test/fixtures/factory-pipeline-status.json' with { type: 'json' };
import type { FactoryAnswers } from '@orchagents/contracts';
import { Emitter } from '@orchagents/base';
import type { Job, OrchEvent, Run } from '@orchagents/contracts';
import {
  answerFactoryGate,
  initFactoryProduct,
  readFactoryPipeline,
  readFactoryTrail,
} from './factoryPipeline.js';
import type { CommandRunner } from '../../queue/node/specMerge.js';
import { SpecsQueueService, type SpecsQueueServiceDeps } from '../../queue/node/specsQueueService.js';
import { createExecCommandRunner } from '../../../shells/node/execCommandRunner.js';

const temporary: string[] = [];

async function setup(factoryStatus: unknown = fixture) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-pipeline-'));
  temporary.push(root);
  const repo = path.join(root, 'repo');
  const scripts = path.join(root, 'factory', 'scripts');
  await fs.mkdir(path.join(repo, '.factory'), { recursive: true });
  await fs.mkdir(path.join(repo, '.orch'), { recursive: true });
  await fs.mkdir(scripts, { recursive: true });
  await fs.writeFile(path.join(repo, '.factory', 'plan.json'), '{}');
  const script = path.join(scripts, 'factory.mjs');
  const callsPath = path.join(root, 'calls.json');
  const output = JSON.stringify(factoryStatus);
  await fs.writeFile(script, `// Fake SaaS Factory used by factoryPipeline.test.ts.\nconsole.log(${JSON.stringify(output)});`);
  await fs.writeFile(path.join(repo, '.orch', 'product.yaml'), `factory: ${JSON.stringify(script)}\n`);
  const runner: CommandRunner = async (command, args, options) => {
    void command; void options;
    const call = args.slice(1);
    const calls = JSON.parse(await fs.readFile(callsPath, 'utf8').catch(() => '[]')) as string[][];
    calls.push([...call]);
    await fs.writeFile(callsPath, JSON.stringify(calls));
    if (call[0] === 'gate' && call[2] === 'wrong') return { exitCode: 2, stdout: '', stderr: 'Factory says choose one.' };
    if (call[0] === 'init') await fs.writeFile(path.join(repo, '.factory', 'plan.json'), '{}');
    return { exitCode: 0, stdout: output, stderr: '' };
  };
  return { root, repo, script, callsPath, runner };
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('factory pipeline service helpers', () => {
  it('reads a product pipeline, keeps skipped stages out of counts, and drops unknown fields (PP-03, PP-04, PP-11)', async () => {
    const status = JSON.parse(JSON.stringify(fixture)) as typeof fixture;
    const research = status.stages.find((stage) => stage.id === 'research');
    if (research) research.state = 'skipped';
    status.counts = { total: 28, done: 11, next: 1, needs_you: 1, left: 16, gates_ahead: 3 };
    const state = await setup(status);
    const res = await readFactoryPipeline(state.repo, { commandRunner: state.runner });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.value) return;
    expect(res.value.stages.find((stage) => stage.id === 'research')?.state).toBe('skipped');
    expect(res.value.counts).toEqual({ total: 28, done: 11, next: 1, needs_you: 1, left: 16, gates_ahead: 3 });
    expect('answers' in res.value).toBe(false);
    expect('gates' in res.value).toBe(false);
    expect(JSON.parse(await fs.readFile(state.callsPath, 'utf8'))[0]).toEqual(['status', state.repo, '--json']);
  });

  it('returns null when the repo has no factory plan', async () => {
    const state = await setup();
    await fs.rm(path.join(state.repo, '.factory', 'plan.json'));
    expect(await readFactoryPipeline(state.repo, { commandRunner: state.runner })).toEqual({ ok: true, value: null });
  });

  it('records a gate via orch then re-reads status; reports the factory error message and fix (PP-12)', async () => {
    const state = await setup();
    const res = await answerFactoryGate(state.repo, 'confirm-brief', 'my words', { commandRunner: state.runner });
    expect(res.ok).toBe(true);
    expect(JSON.parse(await fs.readFile(state.callsPath, 'utf8'))[0]).toEqual(['gate', state.repo, 'confirm-brief', 'my words', '--via', 'orch']);
    const failingRunner: CommandRunner = async (command, args, options) => {
      const result = await state.runner(command, args, options);
      if (args[1] === 'gate') return { ...result, exitCode: 2, stderr: 'Factory says choose one.' };
      return result;
    };
    const rejected = await answerFactoryGate(state.repo, 'confirm-brief', 'wrong', { commandRunner: failingRunner });
    expect(rejected).toMatchObject({ ok: false, error: { message: 'Factory says choose one.', fix: expect.stringContaining('--via orch') } });
  });

  it('initializes with the wizard JSON and reads the resulting plan (PP-13)', async () => {
    const state = await setup();
    await fs.rm(path.join(state.repo, '.factory', 'plan.json'));
    const answers: FactoryAnswers = { brief: 'A useful app', have: {}, surfaces: ['web', 'console'], scope: 'build', specs: 'parallel', agent: 'auto' };
    const res = await initFactoryProduct(state.repo, answers, { commandRunner: state.runner });
    expect(res.ok).toBe(true);
    expect(JSON.parse(await fs.readFile(state.callsPath, 'utf8'))[0]).toEqual(['init', state.repo, '--answers', JSON.stringify(answers)]);
  });

  it('reports the exact too-old factory message when factory.mjs is missing (PP-14)', async () => {
    const state = await setup();
    await fs.rm(state.script);
    await fs.writeFile(path.join(path.dirname(state.script), 'factory-status.mjs'), '');
    const res = await readFactoryPipeline(state.repo, { commandRunner: state.runner });
    expect(res).toMatchObject({ ok: false, error: { message: 'This SaaS Factory doesn’t have the pipeline yet.', fix: 'Update it with npx github:devwaheed/saas-factory.' } });
  });

  it('uses the existing install guidance when no factory status script is installed', async () => {
    const state = await setup();
    await fs.rm(path.join(state.repo, '.orch', 'product.yaml'));
    const res = await readFactoryPipeline(state.repo, { commandRunner: state.runner, home: path.join(state.root, 'empty-home') });
    expect(res).toMatchObject({ ok: false, error: { message: 'SaaS Factory isn’t installed.', fix: 'Install it with npx github:devwaheed/saas-factory, then reopen the project.' } });
  });

  it('counts malformed six-column trail lines and parses valid rows (PP-09)', async () => {
    const state = await setup();
    await fs.writeFile(path.join(state.repo, 'decisions.tsv'), 'time\tstage\tkind\tby\tsummary\tevidence\n2026-01-01T00:00:00Z\tbrief\tdecision\toperator\tUse blue\tdesign/palette.json\nshort\tline\n');
    expect(await readFactoryTrail(state.repo)).toEqual({ ok: true, value: { rows: [{ time: '2026-01-01T00:00:00Z', stage: 'brief', kind: 'decision', by: 'operator', summary: 'Use blue', evidence: ['design/palette.json'] }], unreadable: 1 } });
  });

  it.skipIf(!existsSync('/Users/devwaheed/.claude/plugins/marketplaces/saas-factory/scripts/factory.mjs'))('runs a real factory status integration when the installed factory is available', async () => {
    const state = await setup();
    const realScript = '/Users/devwaheed/.claude/plugins/marketplaces/saas-factory/scripts/factory.mjs';
    await fs.writeFile(path.join(state.repo, '.factory', 'plan.json'), JSON.stringify(fixture));
    await fs.writeFile(path.join(state.repo, '.orch', 'product.yaml'), `factory: ${JSON.stringify(realScript)}\n`);
    const result = await readFactoryPipeline(state.repo, { commandRunner: createExecCommandRunner() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value?.product).toBe('repo');
  });

  it('refreshes when gates.json changes and emits only after a status change (PP-06)', async () => {
    const state = await setup();
    const statusFile = path.join(state.repo, '.factory', 'pipeline.json');
    await fs.writeFile(statusFile, JSON.stringify(fixture));
    await fs.writeFile(state.script, `import fs from 'node:fs/promises'; console.log(await fs.readFile(${JSON.stringify(statusFile)}, 'utf8'));`);
    // This test needs to run the fake factory script: state.runner intentionally
    // returns the setup-time fixture for the other helper tests.
    const commandRunner = createExecCommandRunner();
    const service = new SpecsQueueService({ git: {} as SpecsQueueServiceDeps['git'], commandRunner });
    const events: string[] = [];
    const subscription = service.onEvent((event) => { if (event.type === 'product.changed') events.push(event.repoPath); });
    try {
      await service.factoryPipeline(state.repo);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const changed = JSON.parse(JSON.stringify(fixture)) as { stages: Array<{ id: string; state: string; answer: unknown }> };
      const gate = changed.stages.find((stage) => stage.id === 'confirm-brief');
      if (gate) { gate.state = 'done'; gate.answer = { words: 'Yes', by: 'operator', via: 'chat', at: new Date().toISOString() }; }
      await fs.writeFile(statusFile, JSON.stringify(changed));
      const refreshed = await readFactoryPipeline(state.repo, { commandRunner });
      expect(refreshed.ok && refreshed.value?.stages.find((stage) => stage.id === 'confirm-brief')?.state).toBe('done');
      await fs.writeFile(path.join(state.repo, '.factory', 'gates.json'), '{}');
      await new Promise((resolve) => setTimeout(resolve, 750));
      expect(events).toEqual([state.repo]);
      await fs.writeFile(path.join(state.repo, '.factory', 'gates.json'), '{"irrelevant":true}');
      await new Promise((resolve) => setTimeout(resolve, 750));
      expect(events).toEqual([state.repo]);
    } finally {
      subscription.dispose();
      service.dispose();
    }
  });

  it('starts one no-worktree pipeline job, waits at a gate, and resumes the same session after the answer (PP-15, PP-16, PP-17)', async () => {
    const state = await setup();
    const jobEvents = new Emitter<OrchEvent>();
    const run: Run = {
      id: 'r-1' as Run['id'], jobId: 'j-1' as Job['id'], parentId: null, depth: 0,
      role: 'implementer', task: 'factory task', agent: 'claude', accountId: 'acct-claude' as Run['accountId'],
      status: 'done', worktree: null, readOnly: false, sessionId: 's-0001' as Run['sessionId'], startedAt: new Date().toISOString(), resumesAt: null,
    };
    const job = { id: 'j-1', title: 'pipeline', status: 'running', spec: { mode: 'single', goal: 'pipeline', repoPath: state.repo }, step: null, createdAt: new Date().toISOString(), scheduledFor: null } as Job;
    const sent: string[] = [];
    let jobOptions: unknown;
    const service = new SpecsQueueService({
      git: {} as SpecsQueueServiceDeps['git'], commandRunner: state.runner, installedAgents: ['claude'],
      jobs: {
        start: async (_spec, options) => { jobOptions = options; return { ok: true, value: job }; },
        get: async () => ({ ok: true, value: job }), cancel: async () => ({ ok: true, value: undefined }),
        onEvent: jobEvents.event,
      },
      runs: {
        list: async () => ({ ok: true, value: [run] }),
        lines: async () => ({ ok: true, value: [] }),
        send: async (_runId, text) => { sent.push(text); return { ok: true, value: undefined }; },
        startNow: async () => ({ ok: true, value: undefined }),
        pause: async () => ({ ok: true, value: undefined }),
      },
    });
    try {
      const started = await service.startPipelineRun(state.repo);
      expect(started).toMatchObject({ ok: true, value: 'j-1' });
      expect(jobOptions).toMatchObject({ noWorktree: true, noReview: true });
      expect(await service.pipelineRun(state.repo)).toMatchObject({ ok: true, value: { jobId: 'j-1', state: 'working' } });
      jobEvents.fire({ type: 'run.line', line: { runId: run.id, seq: 1, at: new Date().toISOString(), kind: 'message', text: 'GATE confirm-brief' } });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await service.pipelineRun(state.repo)).toMatchObject({ ok: true, value: { state: 'waiting_gate' } });
      expect(sent).toEqual([]);
      await service.answerFactoryGate(state.repo, 'confirm-brief', 'yes');
      expect(sent).toEqual(['The operator answered confirm-brief. Run factory next and continue.']);
      expect(await service.pipelineRun(state.repo)).toMatchObject({ ok: true, value: { state: 'working' } });
    } finally { service.dispose(); jobEvents.dispose(); }
  });
});
