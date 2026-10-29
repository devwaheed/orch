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
import { FACTORY_TIMEOUT_MS, findFactoryDriver, findFactoryScript } from './factoryStatus.js';

export { findFactoryDriver };
import type { CommandRunner } from '../../queue/node/specMerge.js';
import type { ProductFile } from '@orchagents/contracts';

const PRODUCT_FOLDERS = new Set(['docs', 'design', 'specs', 'refs']);
const PRODUCT_FILE_LIMIT = 2000;
const PRODUCT_TEXT_LIMIT = 1024 * 1024;

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!path.isAbsolute(rel) && rel.split(path.sep)[0] !== '..');
}

function productFileKind(filePath: string): ProductFile['kind'] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'].includes(ext)) return 'image';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.json') return 'json';
  return 'other';
}

export async function listProductFiles(repoPath: string): Promise<Result<ProductFile[]>> {
  const root = path.resolve(repoPath);
  const files: ProductFile[] = [];
  try {
    const realRoot = await fs.realpath(root);
    for (const folder of PRODUCT_FOLDERS) {
      const base = path.join(root, folder);
      const visit = async (directory: string): Promise<void> => {
        if (files.length >= PRODUCT_FILE_LIMIT) return;
        let entries: import('node:fs').Dirent[];
        try { entries = await fs.readdir(directory, { withFileTypes: true }); }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw e;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (files.length >= PRODUCT_FILE_LIMIT) break;
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) { await visit(absolute); continue; }
          if (!entry.isFile()) continue;
          const realFile = await fs.realpath(absolute);
          if (!isWithinRoot(realRoot, realFile)) continue;
          const stat = await fs.stat(realFile);
          files.push({ path: path.relative(root, absolute).split(path.sep).join('/'), kind: productFileKind(absolute), size: stat.size });
        }
      };
      await visit(base);
    }
    return ok(files);
  } catch {
    return err({ code: 'internal', message: 'The project files couldn’t be listed.', fix: 'Check that the project folders can be read, then refresh Files.' });
  }
}

export async function readProductFile(repoPath: string, relPath: string): Promise<Result<string>> {
  const segments = relPath.split('/');
  if (!relPath || relPath.includes('..') || relPath.includes('\\') || path.isAbsolute(relPath) || !PRODUCT_FOLDERS.has(segments[0] ?? '') || segments.some((part) => !part || part.startsWith('.') || part === 'node_modules')) {
    return err({ code: 'validation_failed', message: 'That file is outside the product folders or has an unsafe path.', fix: 'Choose a file under docs/, design/, specs/ or refs/.' });
  }
  const ext = path.extname(relPath).toLowerCase();
  if (!['.md', '.markdown', '.json', '.txt'].includes(ext)) {
    return err({ code: 'validation_failed', message: 'That product file is not a supported text file.', fix: 'Choose a Markdown, JSON or TXT file.' });
  }
  try {
    const root = await fs.realpath(path.resolve(repoPath));
    const target = path.resolve(root, ...segments);
    if (!isWithinRoot(root, target)) return err({ code: 'validation_failed', message: 'That file is outside the product folders.', fix: 'Choose a file under docs/, design/, specs/ or refs/.' });
    const realTarget = await fs.realpath(target);
    if (!isWithinRoot(root, realTarget) || !PRODUCT_FOLDERS.has(path.relative(root, realTarget).split(path.sep)[0] ?? '')) {
      return err({ code: 'validation_failed', message: 'That file is outside the product folders.', fix: 'Choose a file under docs/, design/, specs/ or refs/.' });
    }
    const stat = await fs.stat(realTarget);
    if (!stat.isFile()) return err({ code: 'not_found', message: 'That product file could not be read.', fix: 'Choose a file from the Files list.' });
    if (stat.size > PRODUCT_TEXT_LIMIT) return err({ code: 'validation_failed', message: 'That product file is larger than 1 MB.', fix: 'Open it with the operating system.' });
    return ok(await fs.readFile(realTarget, 'utf8'));
  } catch {
    return err({ code: 'not_found', message: 'That product file could not be read.', fix: 'Choose a file from the Files list.' });
  }
}

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
  const home = options.home ?? os.homedir();
  try {
    const config = parse(await fs.readFile(path.join(repoPath, '.orch', 'product.yaml'), 'utf8')) as unknown;
    if (typeof config === 'object' && config !== null && 'factory' in config && typeof config.factory === 'string') {
      const configured = path.resolve(repoPath, config.factory);
      if (await exists(configured)) return configured;
      const statusBeside = path.join(path.dirname(configured), 'factory-status.mjs');
      if (await exists(statusBeside)) {
        return configured;
      }
    }
  } catch {
    // Missing optional product config falls back to factory discovery.
  }

  const driver = await findFactoryDriver(home);
  if (driver) return driver;

  const statusScript = await findFactoryScript(home);
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
