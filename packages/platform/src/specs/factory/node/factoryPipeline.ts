import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { err, ok } from '@orchagents/base';
import {
  FactoryPipeline as FactoryPipelineSchema,
  TrailResult,
  type FactoryAnswers,
  type FactoryPipeline,
  type Result,
  type TrailResult as TrailResultType,
} from '@orchagents/contracts';
import { parse } from 'yaml';
import { FACTORY_TIMEOUT_MS, findFactoryScript } from './factoryStatus.js';
import type { CommandRunner } from '../../queue/node/specMerge.js';

export interface FactoryPipelineOptions {
  readonly commandRunner: CommandRunner;
  readonly home?: string;
}

const tooOld = {
  code: 'not_found' as const,
  message: 'This SaaS Factory doesn’t have the pipeline yet.',
  fix: 'Update it with npx github:devwaheed/saas-factory.',
};
const notInstalled = {
  code: 'not_found' as const,
  message: 'SaaS Factory isn’t installed.',
  fix: 'Install it with npx github:devwaheed/saas-factory, then reopen the project.',
};

const readError = (command: string, detail?: string) => ({
  code: 'internal' as const,
  message: detail?.trim() || 'SaaS Factory couldn’t read this project.',
  fix: `Run ${command} in a terminal to see the error.`,
});

async function exists(target: string): Promise<boolean> {
  try { await fs.access(target); return true; } catch { return false; }
}

export async function resolveFactoryPipelineScript(repoPath: string, options: FactoryPipelineOptions): Promise<string | null> {
  try {
    const config = parse(await fs.readFile(path.join(repoPath, '.orch', 'product.yaml'), 'utf8')) as unknown;
    if (typeof config === 'object' && config !== null && 'factory' in config && typeof config.factory === 'string') {
      const configured = path.resolve(repoPath, config.factory);
      return await exists(configured) ? configured : configured;
    }
  } catch {
    // Missing optional product config falls back to factory discovery.
  }
  const statusScript = await findFactoryScript(options.home ?? os.homedir());
  return statusScript ? path.join(path.dirname(statusScript), 'factory.mjs') : null;
}

async function runFactory(
  repoPath: string,
  script: string,
  args: readonly string[],
  options: FactoryPipelineOptions,
): Promise<{ exitCode: number; stdout: string; stderr: string } | Result<never>> {
  try {
    return await options.commandRunner(process.execPath, [script, ...args], {
      cwd: repoPath,
      timeoutMs: FACTORY_TIMEOUT_MS,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  } catch (e) {
    return err(readError(`node ${script} ${args.join(' ')}`, e instanceof Error ? e.message : undefined));
  }
}

export async function readFactoryPipeline(repoPath: string, options: FactoryPipelineOptions): Promise<Result<FactoryPipeline | null>> {
  if (!(await exists(path.join(repoPath, '.factory', 'plan.json')))) return ok(null);
  const script = await resolveFactoryPipelineScript(repoPath, options);
  if (!script) return err(notInstalled);
  if (!(await exists(script))) return err(tooOld);
  const args = ['status', repoPath, '--json'];
  const run = await runFactory(repoPath, script, args, options);
  if (!('exitCode' in run)) return run;
  if (run.exitCode !== 0) return err(readError(`node ${script} ${args.join(' ')}`, run.stderr));
  try {
    const parsed = FactoryPipelineSchema.safeParse(JSON.parse(run.stdout));
    if (!parsed.success) return err(readError(`node ${script} ${args.join(' ')}`));
    return ok(parsed.data as FactoryPipeline);
  } catch {
    return err(readError(`node ${script} ${args.join(' ')}`));
  }
}

export async function answerFactoryGate(
  repoPath: string,
  gateId: string,
  words: string,
  options: FactoryPipelineOptions,
): Promise<Result<FactoryPipeline>> {
  const script = await resolveFactoryPipelineScript(repoPath, options);
  if (!script) return err(notInstalled);
  if (!(await exists(script))) return err(tooOld);
  const result = await runFactory(repoPath, script, ['gate', repoPath, gateId, words, '--via', 'orch'], options);
  if (!('exitCode' in result)) return result;
  if (result.exitCode !== 0) {
    return err(readError(`node ${script} gate ${repoPath} ${gateId} "${words}" --via orch`, result.stderr || result.stdout));
  }
  const refreshed = await readFactoryPipeline(repoPath, options);
  if (!refreshed.ok) return refreshed;
  if (!refreshed.value) return err(readError(`node ${script} status ${repoPath} --json`));
  return ok(refreshed.value as FactoryPipeline);
}

export async function initFactoryProduct(
  repoPath: string,
  answers: FactoryAnswers,
  options: FactoryPipelineOptions,
): Promise<Result<FactoryPipeline>> {
  const script = await resolveFactoryPipelineScript(repoPath, options);
  if (!script) return err(notInstalled);
  if (!(await exists(script))) return err(tooOld);
  const result = await runFactory(repoPath, script, ['init', repoPath, '--answers', JSON.stringify(answers)], options);
  if (!('exitCode' in result)) return result;
  if (result.exitCode !== 0) return err(readError(`node ${script} init ${repoPath} --answers '<json>'`, result.stderr || result.stdout));
  const refreshed = await readFactoryPipeline(repoPath, options);
  if (!refreshed.ok) return refreshed;
  if (!refreshed.value) return err(readError(`node ${script} status ${repoPath} --json`));
  return ok(refreshed.value as FactoryPipeline);
}

export async function readFactoryTrail(repoPath: string): Promise<Result<TrailResultType>> {
  const file = path.join(repoPath, 'decisions.tsv');
  let content: string;
  try { content = await fs.readFile(file, 'utf8'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ok({ rows: [], unreadable: 0 });
    return err({ code: 'internal', message: 'The decision trail could not be read.', fix: 'Check read permissions for decisions.tsv.' });
  }
  const lines = content.split(/\r?\n/);
  const data = lines.slice(1).filter((line) => line.length > 0);
  const rows: TrailResultType['rows'] = [];
  let unreadable = 0;
  for (const line of data) {
    const columns = line.split('\t');
    if (columns.length !== 6 || (columns[3] !== 'operator' && columns[3] !== 'agent')) { unreadable++; continue; }
    const [time, stage, kind, by, summary, evidence] = columns;
    rows.push({ time: time!, stage: stage!, kind: kind!, by: by as 'operator' | 'agent', summary: summary!, evidence: evidence ? evidence.split(' ').filter(Boolean) : [] });
  }
  const checked = TrailResult.safeParse({ rows, unreadable });
  return checked.success ? ok(checked.data) : err({ code: 'internal', message: 'The decision trail could not be read.', fix: 'Check the decisions.tsv format.' });
}
