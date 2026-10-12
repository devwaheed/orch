/**
 * Main spec loader: reads spec files and .orch/specs.yaml, validates schemas and dependencies,
 * and reports all load problems with exact messages (docs/specs/spec-queue.md §2, §3, §11).
 */
import { err, ok } from '@orchagents/base';
import {
  SpecQueue,
  type QueueId,
  type Result,
  type SpecFile,
  type SpecId,
  type SpecLoadProblem,
  type SpecRun,
  type Timestamp,
} from '@orchagents/contracts';
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { validateSpecs, type LoadedSpecDefinition } from '../common/validate.js';
import { parseSpecContent } from './frontMatter.js';
import { loadSpecQueueSettings } from './settings.js';

export interface LoadedSpecQueueResult {
  readonly queue: SpecQueue | null;
  readonly problems: readonly SpecLoadProblem[];
}

export interface LoadedSpecWithBody extends LoadedSpecDefinition {
  readonly body: string;
}

/**
 * Loads the spec queue from repoPath.
 * Returns { queue: null, problems: [...] } if any load problems exist.
 * Returns { queue: SpecQueue, problems: [] } on success.
 */
export async function loadSpecQueue(repoPath: string): Promise<Result<LoadedSpecQueueResult>> {
  const settingsResult = await loadSpecQueueSettings(repoPath);
  if (!settingsResult.ok) {
    return err(settingsResult.error);
  }
  const settings = settingsResult.value;

  const specsDir = path.resolve(repoPath, settings.source);
  let fileNames: string[] = [];
  try {
    const entries = await readdir(specsDir, { withFileTypes: true });
    // Every *.md file in that folder (not subfolders) is a spec (§2)
    fileNames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const queueId = `q-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` as QueueId;
      const emptyQueue: SpecQueue = {
        id: queueId,
        repoPath,
        settings,
        paused: false,
        specs: [],
        createdAt: new Date().toISOString() as Timestamp,
      };
      return ok({
        queue: emptyQueue,
        problems: [],
      });
    }
    return err({
      code: 'internal',
      message: `Failed to read specs folder: ${(error as Error).message}`,
    });
  }

  const problems: SpecLoadProblem[] = [];
  const validSpecs: LoadedSpecWithBody[] = [];

  for (const fileName of fileNames) {
    const fullPath = path.join(specsDir, fileName);
    const relFile = path.relative(repoPath, fullPath).replaceAll('\\', '/');

    let content: string;
    try {
      content = await readFile(fullPath, 'utf8');
    } catch {
      problems.push({
        file: relFile,
        code: 'invalid_front_matter',
        message: `${relFile}: failed to read file. See docs/specs/templates/spec.md.`,
      });
      continue;
    }

    const parsed = parseSpecContent(content, relFile);
    if (!parsed.ok) {
      problems.push(parsed.problem);
    } else {
      validSpecs.push({
        file: relFile,
        spec: parsed.data.spec,
        body: parsed.data.body,
      });
    }
  }

  // Validate the collection of successfully parsed specs
  const graphProblems = validateSpecs(validSpecs);
  problems.push(...graphProblems);

  if (problems.length > 0) {
    return ok({
      queue: null,
      problems,
    });
  }

  // Order: ascending numeric id (spec-queue.md §2)
  validSpecs.sort((a, b) => {
    const diff = Number(a.spec.id) - Number(b.spec.id);
    if (diff !== 0) {
      return diff;
    }
    return a.file.localeCompare(b.file);
  });

  const queueId = `q-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` as QueueId;
  const runs: SpecRun[] = validSpecs.map((item, index) => ({
    id: item.spec.id as SpecId,
    queueId,
    position: index + 1,
    file: item.file,
    spec: item.spec,
    state: 'queued',
    attempt: null,
    jobId: null,
    worktree: null,
    implementer: null,
    criteria: item.spec.done_when.map((_, cIndex) => ({
      index: cIndex,
      state: 'pending',
      summary: null,
      auditor: null,
    })),
    blockedBy: [],
    startedAt: null,
    finishedAt: null,
    tokens: 0,
  }));

  const queue: SpecQueue = {
    id: queueId,
    repoPath,
    settings,
    paused: false,
    specs: runs,
    createdAt: new Date().toISOString() as Timestamp,
  };

  // Verify that the queue matches the schema contract
  const validated = SpecQueue.safeParse(queue);
  if (!validated.success) {
    return err({
      code: 'internal',
      message: `Failed to construct valid SpecQueue: ${validated.error.message}`,
    });
  }

  return ok({
    queue: validated.data,
    problems: [],
  });
}

/**
 * Reads a single spec file and returns its parsed SpecFile and body text.
 */
export async function readSpecFile(
  repoPath: string,
  relativeOrFullPath: string,
): Promise<Result<{ spec: SpecFile; body: string }>> {
  const fullPath = path.isAbsolute(relativeOrFullPath)
    ? relativeOrFullPath
    : path.resolve(repoPath, relativeOrFullPath);

  let content: string;
  try {
    content = await readFile(fullPath, 'utf8');
  } catch {
    return err({
      code: 'not_found',
      message: `Spec file not found: ${relativeOrFullPath}`,
      fix: 'Verify the spec file path exists.',
    });
  }

  const relFile = path.relative(repoPath, fullPath).replaceAll('\\', '/');
  const parsed = parseSpecContent(content, relFile);
  if (!parsed.ok) {
    return err({
      code: 'validation_failed',
      message: parsed.problem.message,
    });
  }

  return ok(parsed.data);
}
