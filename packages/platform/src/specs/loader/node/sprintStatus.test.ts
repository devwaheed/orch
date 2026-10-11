import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectSprintStatus } from './sprintStatus.js';

describe('detectSprintStatus (spec-queue.md §2)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'orch-sprint-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null when neither file exists', async () => {
    const res = await detectSprintStatus(tmpDir);
    expect(res).toBeNull();
  });

  it('detects docs/sprint-status.yaml', async () => {
    const docsDir = path.join(tmpDir, 'docs');
    await mkdir(docsDir, { recursive: true });
    await writeFile(path.join(docsDir, 'sprint-status.yaml'), 'stories: {}\n', 'utf8');

    const res = await detectSprintStatus(tmpDir);
    expect(res).toBe('docs/sprint-status.yaml');
  });

  it('detects docs/stories/sprint-status.yaml when docs/sprint-status.yaml is absent', async () => {
    const storiesDir = path.join(tmpDir, 'docs', 'stories');
    await mkdir(storiesDir, { recursive: true });
    await writeFile(path.join(storiesDir, 'sprint-status.yaml'), 'stories: {}\n', 'utf8');

    const res = await detectSprintStatus(tmpDir);
    expect(res).toBe('docs/stories/sprint-status.yaml');
  });

  it('prioritizes docs/sprint-status.yaml if both exist', async () => {
    const docsDir = path.join(tmpDir, 'docs');
    const storiesDir = path.join(tmpDir, 'docs', 'stories');
    await mkdir(storiesDir, { recursive: true });
    await writeFile(path.join(docsDir, 'sprint-status.yaml'), 'stories: 1\n', 'utf8');
    await writeFile(path.join(storiesDir, 'sprint-status.yaml'), 'stories: 2\n', 'utf8');

    const res = await detectSprintStatus(tmpDir);
    expect(res).toBe('docs/sprint-status.yaml');
  });
});
