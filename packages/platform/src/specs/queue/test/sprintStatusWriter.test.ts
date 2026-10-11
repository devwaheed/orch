import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { updateSprintStatusOnMerge } from '../node/sprintStatusWriter.js';

describe('sprintStatusWriter (SQ-22, §2)', () => {
  it('updates matching story status to done upon merge', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sprint-'));
    try {
      const docsDir = path.join(tmp, 'docs');
      await fs.mkdir(docsDir, { recursive: true });
      const sprintPath = path.join(docsDir, 'sprint-status.yaml');

      const initialYaml = `# Sprint Status
sprint: 4
stories:
  story-01: in-progress
  story-02: ready
`;
      await fs.writeFile(sprintPath, initialYaml, 'utf8');

      const res = await updateSprintStatusOnMerge(tmp, 'story-01');
      expect(res.ok).toBe(true);
      expect(res.ok && res.value).toBe(true);

      const updated = await fs.readFile(sprintPath, 'utf8');
      expect(updated).toContain('story-01: done');
      expect(updated).toContain('story-02: ready');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('handles missing sprint-status.yaml gracefully', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-sprint-none-'));
    try {
      const res = await updateSprintStatusOnMerge(tmp, 'story-01');
      expect(res.ok).toBe(true);
      expect(res.ok && res.value).toBe(false);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
