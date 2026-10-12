/**
 * BMAD story initialization (docs/specs/spec-queue.md §2 and §13).
 * Adds a front-matter skeleton to each story that lacks one.
 */
import { err, ok } from '@orchagents/base';
import type { Result } from '@orchagents/contracts';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { formatBmadFrontMatter, hasFrontMatter, parseBmadStory } from '../common/bmad.js';

export interface InitBmadOptions {
  readonly repoPath: string;
  readonly storiesDir?: string;
  readonly targetDir?: string;
  readonly dryRun?: boolean;
}

export interface BmadInitItem {
  readonly file: string;
  readonly id: string;
  readonly title: string;
  readonly criteriaCount: number;
}

export interface BmadInitReport {
  readonly added: readonly BmadInitItem[];
  readonly skipped: readonly string[];
}

export async function initBmadStories(options: InitBmadOptions): Promise<Result<BmadInitReport>> {
  const storiesDirPath = options.storiesDir
    ? path.resolve(options.repoPath, options.storiesDir)
    : path.join(options.repoPath, 'docs', 'stories');

  let entries: string[];
  try {
    entries = await readdir(storiesDirPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return err({
        code: 'not_found',
        message: `BMAD stories directory not found: ${options.storiesDir ?? 'docs/stories'}`,
        fix: 'Create the directory or specify a valid stories path.',
      });
    }
    return err({
      code: 'internal',
      message: `Failed to read stories directory: ${(error as Error).message}`,
    });
  }

  const mdFiles = entries.filter((e) => e.endsWith('.md')).sort();
  const added: BmadInitItem[] = [];
  const skipped: string[] = [];

  const targetDirPath = options.targetDir
    ? path.resolve(options.repoPath, options.targetDir)
    : storiesDirPath;

  if (options.targetDir && !options.dryRun) {
    await mkdir(targetDirPath, { recursive: true });
  }

  for (const file of mdFiles) {
    const sourceFilePath = path.join(storiesDirPath, file);
    const content = await readFile(sourceFilePath, 'utf8');

    if (hasFrontMatter(content)) {
      skipped.push(file);
      continue;
    }

    const parsed = parseBmadStory(content, file);
    const id = parsed.id;
    const title = parsed.title;
    const frontMatter = formatBmadFrontMatter({
      id,
      title,
      criteria: parsed.criteria,
    });

    const newContent = `${frontMatter}\n\n${content}`;

    if (!options.dryRun) {
      const destFilePath = path.join(targetDirPath, file);
      await writeFile(destFilePath, newContent, 'utf8');
    }

    const relFile = path.relative(options.repoPath, path.join(targetDirPath, file)).replaceAll('\\', '/');
    added.push({
      file: relFile,
      id,
      title,
      criteriaCount: parsed.criteria.length,
    });
  }

  return ok({ added, skipped });
}
