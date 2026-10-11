import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initBmadStories } from './bmadInit.js';
import { parseSpecContent } from './frontMatter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../../../../test/fixtures/specs/bmad');

describe('initBmadStories on sample BMAD folder', () => {
  let tmpRepo: string;
  let tmpStories: string;

  beforeEach(async () => {
    tmpRepo = await mkdtemp(path.join(tmpdir(), 'orch-bmad-init-test-'));
    tmpStories = path.join(tmpRepo, 'docs', 'stories');
    await cp(FIXTURE_DIR, tmpStories, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRepo, { recursive: true, force: true });
  });

  it('adds front-matter skeleton to stories that lack it and skips existing', async () => {
    const res = await initBmadStories({
      repoPath: tmpRepo,
      storiesDir: 'docs/stories',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.added).toHaveLength(2);
      expect(res.value.skipped).toEqual(['003-already-init.md']);

      const story1 = res.value.added.find((item) => item.id === '1');
      expect(story1).toBeDefined();
      expect(story1?.title).toBe('User login');
      expect(story1?.criteriaCount).toBe(3);

      const story2 = res.value.added.find((item) => item.id === '2');
      expect(story2).toBeDefined();
      expect(story2?.title).toBe('Profile page');
      expect(story2?.criteriaCount).toBe(2);

      // Verify that the updated files now pass spec parsing and schema validation
      const updated1 = await readFile(path.join(tmpStories, '001-user-login.md'), 'utf8');
      const parsed1 = parseSpecContent(updated1, 'docs/stories/001-user-login.md');
      expect(parsed1.ok).toBe(true);
      if (parsed1.ok) {
        expect(parsed1.data.spec.id).toBe('1');
        expect(parsed1.data.spec.title).toBe('User login');
        expect(parsed1.data.spec.done_when).toHaveLength(3);
        expect(parsed1.data.spec.done_when[0]?.by).toBe('audit');
      }

      const updated2 = await readFile(path.join(tmpStories, '002-profile-page.md'), 'utf8');
      const parsed2 = parseSpecContent(updated2, 'docs/stories/002-profile-page.md');
      expect(parsed2.ok).toBe(true);
      if (parsed2.ok) {
        expect(parsed2.data.spec.id).toBe('2');
        expect(parsed2.data.spec.title).toBe('Profile page');
        expect(parsed2.data.spec.done_when).toHaveLength(2);
      }
    }
  });

  it('can write output to a separate target directory', async () => {
    const targetSpecs = path.join(tmpRepo, 'docs', 'specs');
    const res = await initBmadStories({
      repoPath: tmpRepo,
      storiesDir: 'docs/stories',
      targetDir: 'docs/specs',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.added).toHaveLength(2);
      const generatedFile = await readFile(path.join(targetSpecs, '001-user-login.md'), 'utf8');
      const parsed = parseSpecContent(generatedFile, 'docs/specs/001-user-login.md');
      expect(parsed.ok).toBe(true);
    }
  });
});
