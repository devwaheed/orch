import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSpecQueue, readSpecFile } from './specLoader.js';

describe('loadSpecQueue & Acceptance scenarios SQ-20, SQ-21', () => {
  let tmpRepo: string;
  let specsDir: string;

  beforeEach(async () => {
    tmpRepo = await mkdtemp(path.join(tmpdir(), 'orch-spec-loader-test-'));
    specsDir = path.join(tmpRepo, 'docs', 'specs');
    await mkdir(specsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRepo, { recursive: true, force: true });
  });

  // Acceptance scenario SQ-20: Spec depends on a later id -> Problem dependency_later_in_order; queue does not start
  it('SQ-20: Spec depends on a later id reports dependency_later_in_order and queue does not start', async () => {
    await writeFile(
      path.join(specsDir, '001-first.md'),
      `---
id: "1"
title: "First"
depends_on: ["2"]
scope: []
done_when:
  - by: audit
    text: "AC 1"
---
First goal.
`,
      'utf8',
    );
    await writeFile(
      path.join(specsDir, '002-second.md'),
      `---
id: "2"
title: "Second"
depends_on: []
scope: []
done_when:
  - by: audit
    text: "AC 2"
---
Second goal.
`,
      'utf8',
    );

    const res = await loadSpecQueue(tmpRepo);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.queue).toBeNull();
      const problem = res.value.problems.find((p) => p.code === 'dependency_later_in_order');
      expect(problem).toBeDefined();
      expect(problem).toEqual({
        file: 'docs/specs/001-first.md',
        code: 'dependency_later_in_order',
        message: 'Spec 1 depends on 2, which comes later. Dependencies must come first.',
      });
    }
  });

  // Acceptance scenario SQ-21: Two files with the same id -> Problem duplicate_id; queue does not start
  it('SQ-21: Two files with the same id reports duplicate_id and queue does not start', async () => {
    await writeFile(
      path.join(specsDir, '042-first.md'),
      `---
id: "42"
title: "First"
depends_on: []
scope: []
done_when:
  - by: audit
    text: "AC 1"
---
First goal.
`,
      'utf8',
    );
    await writeFile(
      path.join(specsDir, '042-second.md'),
      `---
id: "42"
title: "Second duplicate"
depends_on: []
scope: []
done_when:
  - by: audit
    text: "AC 2"
---
Second goal.
`,
      'utf8',
    );

    const res = await loadSpecQueue(tmpRepo);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.queue).toBeNull();
      const problem = res.value.problems.find((p) => p.code === 'duplicate_id');
      expect(problem).toBeDefined();
      expect(problem).toEqual({
        file: 'docs/specs/042-second.md',
        code: 'duplicate_id',
        message: 'Spec 42 is defined in both docs/specs/042-first.md and docs/specs/042-second.md.',
      });
    }
  });

  describe('One test per problem code (spec-queue.md §11)', () => {
    it('reports invalid_front_matter', async () => {
      await writeFile(
        path.join(specsDir, '001-bad.md'),
        `# A story without front matter
Body only.
`,
        'utf8',
      );

      const res = await loadSpecQueue(tmpRepo);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.queue).toBeNull();
        expect(res.value.problems).toHaveLength(1);
        expect(res.value.problems[0]).toEqual({
          file: 'docs/specs/001-bad.md',
          code: 'invalid_front_matter',
          message: 'docs/specs/001-bad.md: missing front matter. See docs/specs/templates/spec.md.',
        });
      }
    });

    it('reports duplicate_id', async () => {
      await writeFile(
        path.join(specsDir, '010-a.md'),
        `---
id: "10"
title: "Ten A"
depends_on: []
scope: []
done_when:
  - by: audit
    text: "Done"
---
`,
        'utf8',
      );
      await writeFile(
        path.join(specsDir, '010-b.md'),
        `---
id: "10"
title: "Ten B"
depends_on: []
scope: []
done_when:
  - by: audit
    text: "Done"
---
`,
        'utf8',
      );

      const res = await loadSpecQueue(tmpRepo);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.queue).toBeNull();
        const problem = res.value.problems.find((p) => p.code === 'duplicate_id');
        expect(problem).toEqual({
          file: 'docs/specs/010-b.md',
          code: 'duplicate_id',
          message: 'Spec 10 is defined in both docs/specs/010-a.md and docs/specs/010-b.md.',
        });
      }
    });

    it('reports unknown_dependency', async () => {
      await writeFile(
        path.join(specsDir, '001-spec.md'),
        `---
id: "1"
title: "First"
depends_on: ["99"]
scope: []
done_when:
  - by: audit
    text: "Done"
---
`,
        'utf8',
      );

      const res = await loadSpecQueue(tmpRepo);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.queue).toBeNull();
        expect(res.value.problems).toEqual([
          {
            file: 'docs/specs/001-spec.md',
            code: 'unknown_dependency',
            message: "Spec 1 depends on 99, which doesn't exist.",
          },
        ]);
      }
    });

    it('reports dependency_later_in_order', async () => {
      await writeFile(
        path.join(specsDir, '005-five.md'),
        `---
id: "5"
title: "Five"
depends_on: ["10"]
scope: []
done_when:
  - by: audit
    text: "Done"
---
`,
        'utf8',
      );
      await writeFile(
        path.join(specsDir, '010-ten.md'),
        `---
id: "10"
title: "Ten"
depends_on: []
scope: []
done_when:
  - by: audit
    text: "Done"
---
`,
        'utf8',
      );

      const res = await loadSpecQueue(tmpRepo);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.queue).toBeNull();
        expect(res.value.problems).toEqual([
          {
            file: 'docs/specs/005-five.md',
            code: 'dependency_later_in_order',
            message: 'Spec 5 depends on 10, which comes later. Dependencies must come first.',
          },
        ]);
      }
    });

    it('reports dependency_cycle', async () => {
      await writeFile(
        path.join(specsDir, '001-one.md'),
        `---
id: "1"
title: "One"
depends_on: ["2"]
scope: []
done_when:
  - by: audit
    text: "Done"
---
`,
        'utf8',
      );
      await writeFile(
        path.join(specsDir, '002-two.md'),
        `---
id: "2"
title: "Two"
depends_on: ["1"]
scope: []
done_when:
  - by: audit
    text: "Done"
---
`,
        'utf8',
      );

      const res = await loadSpecQueue(tmpRepo);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.queue).toBeNull();
        const cycle = res.value.problems.find((p) => p.code === 'dependency_cycle');
        expect(cycle).toBeDefined();
        expect(cycle?.message).toBe('Specs 1 → 2 → 1 depend on each other.');
      }
    });

    it('reports scope_outside_repo', async () => {
      await writeFile(
        path.join(specsDir, '001-outside.md'),
        `---
id: "1"
title: "Outside"
depends_on: []
scope:
  - "../other-repo/**"
done_when:
  - by: audit
    text: "Done"
---
`,
        'utf8',
      );

      const res = await loadSpecQueue(tmpRepo);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.queue).toBeNull();
        expect(res.value.problems).toEqual([
          {
            file: 'docs/specs/001-outside.md',
            code: 'scope_outside_repo',
            message: 'Spec 1: scope ../other-repo/** points outside the repository.',
          },
        ]);
      }
    });
  });

  describe('Successful queue load', () => {
    it('creates SpecQueue with specs ordered by ascending numeric id and initial position', async () => {
      await writeFile(
        path.join(specsDir, '020-auth.md'),
        `---
id: "20"
title: "Auth flow"
depends_on: ["10"]
scope: ["src/auth/**"]
done_when:
  - by: check
    text: "Passes tests"
    check:
      kind: command
      run: npm test
  - by: audit
    text: "Audit review"
---
Implement authentication.
`,
        'utf8',
      );
      await writeFile(
        path.join(specsDir, '010-base.md'),
        `---
id: "10"
title: "Base setup"
depends_on: []
scope: ["src/base/**"]
done_when:
  - by: audit
    text: "Base audit"
---
Setup base module.
`,
        'utf8',
      );

      const res = await loadSpecQueue(tmpRepo);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.problems).toEqual([]);
        const queue = res.value.queue;
        expect(queue).not.toBeNull();
        if (queue) {
          expect(queue.paused).toBe(false);
          expect(queue.specs).toHaveLength(2);

          const [s1, s2] = queue.specs;
          expect(s1).toBeDefined();
          expect(s2).toBeDefined();
          if (s1 && s2) {
            expect(s1.id).toBe('10');
            expect(s1.position).toBe(1);
            expect(s1.state).toBe('queued');
            expect(s1.attempt).toBeNull();
            expect(s1.jobId).toBeNull();
            expect(s1.worktree).toBeNull();
            expect(s1.criteria).toHaveLength(1);
            expect(s1.criteria[0]).toEqual({
              index: 0,
              state: 'pending',
              summary: null,
              auditor: null,
            });

            // Spec 20 should be position 2
            expect(s2.id).toBe('20');
            expect(s2.position).toBe(2);
            expect(s2.state).toBe('queued');
            expect(s2.criteria).toHaveLength(2);
          }
        }
      }
    });

    it('reads single spec with body text', async () => {
      await writeFile(
        path.join(specsDir, '042-callback.md'),
        `---
id: "42"
title: "Callback flow"
depends_on: []
scope: []
done_when:
  - by: audit
    text: "Audit"
---
This is the free text body goal.
`,
        'utf8',
      );

      const res = await readSpecFile(tmpRepo, 'docs/specs/042-callback.md');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.spec.id).toBe('42');
        expect(res.value.spec.title).toBe('Callback flow');
        expect(res.value.body).toBe('This is the free text body goal.');
      }
    });
  });
});
