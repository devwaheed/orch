import { beforeEach, describe, expect, it } from 'vitest';
import type { Job, JobId, QueueId, RunId, SpecQueue, SpecRun } from '@orchagents/contracts';
import { AccountId, SpecId, WorktreeId } from '@orchagents/contracts';
import { useWorkbenchStore } from '../src/browser/services/workbenchStore.js';
import { useSpecsUiStore } from '../src/browser/contrib/specs/stores/specsUi.js';
import { useSpecsStore } from '../src/browser/services/stores/specs.js';
import { useJobsStore, useRunsStore } from '../src/browser/services/stores/work.js';
import { useSidebarStore } from '../src/browser/contrib/work/stores/sidebarStore.js';
import { usePanesStore } from '../src/browser/contrib/work/stores/panesStore.js';
import { openJobRun } from '../src/browser/contrib/work/openJobRun.js';
import { partitionJobs } from '../src/browser/contrib/work/model/sidebarModel.js';
import { applyOrchEvent } from '../src/browser/services/stores/apply.js';
import { sampleRun } from './fixtures.js';

describe('Specs → Live view', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({ activeArea: 'specs', activeRoute: '/specs' });
    useSpecsUiStore.setState({ view: 'list' });
    useSidebarStore.setState({ openJobs: {} });
    useJobsStore.setState({ jobs: [] });
    useRunsStore.setState({ runs: [] });
    useSpecsStore.setState({ queues: [] });
    usePanesStore.setState({
      tabsA: [],
      tabsB: [],
      activeA: null,
      activeB: null,
      split: false,
      focused: 'A',
    });
  });

  describe('Live labels a job by its spec and puts others under "Not from a spec"', () => {
    it('partitions jobs into spec jobs and non-spec jobs, labelling spec jobs with spec id and title', () => {
      const spec: SpecRun = {
        id: SpecId.parse('042'),
        queueId: 'q-test' as QueueId,
        position: 0,
        file: 'docs/specs/042-callback.md',
        spec: {
          id: '042',
          title: 'Integration tests for callback flow',
          depends_on: [],
          scope: ['src/auth/**'],
          done_when: [{ by: 'audit', text: 'The goal is met' }],
          agent: 'auto',
          mode: 'single',
          agents: [],
        },
        state: 'running',
        attempt: 1,
        jobId: 'job-spec-1' as JobId,
        worktree: WorktreeId.parse('orch/spec-042'),
        implementer: { agent: 'codex', accountId: AccountId.parse('codex-1') },
        criteria: [],
        blockedBy: [],
        startedAt: '2026-10-11T10:00:00Z',
        finishedAt: null,
        tokens: 1000,
        history: [],
      };

      const queue: SpecQueue = {
        id: 'q-test' as QueueId,
        repoPath: '/work/my-repo',
        paused: false,
        createdAt: '2026-10-11T09:00:00Z',
        settings: {
          source: 'docs/specs',
          order: 'waves',
          advance: 'verified',
          retries: 2,
          on_fail: 'retry-stop',
          max_parallel: 2,
          after_each: [],
        },
        specs: [spec],
      };

      const jobFromSpec: Job = {
        id: 'job-spec-1' as JobId,
        title: 'Spec 042 job',
        status: 'running',
        spec: {
          mode: 'single',
          goal: 'Raw goal text that should be overridden by spec title',
          repoPath: '/work/my-repo',
          checks: [],
          onLimit: 'switch-account',
          orchestrator: { agent: 'claude', account: 'auto' },
          workers: ['codex'],
        },
        step: null,
        createdAt: '2026-10-11T10:00:00Z',
        scheduledFor: null,
      };

      const jobNotFromSpec: Job = {
        id: 'job-orphan-2' as JobId,
        title: 'Standalone terminal run',
        status: 'running',
        spec: {
          mode: 'single',
          goal: 'Standalone terminal run',
          repoPath: '/work/my-repo',
          checks: [],
          onLimit: 'switch-account',
          orchestrator: { agent: 'claude', account: 'auto' },
          workers: ['codex'],
        },
        step: null,
        createdAt: '2026-10-11T10:05:00Z',
        scheduledFor: null,
      };

      useSpecsStore.getState().upsertQueue(queue);
      useJobsStore.getState().upsertJob(jobFromSpec);
      useJobsStore.getState().upsertJob(jobNotFromSpec);

      // Verify partition logic used by JobsSidebar:
      const specByJobId = new Map<string, SpecRun>();
      for (const s of queue.specs) {
        if (s.jobId) specByJobId.set(s.jobId, s);
      }

      const allJobs = [jobFromSpec, jobNotFromSpec];
      const specJobs = allJobs.filter((j) => specByJobId.has(j.id));
      const nonSpecJobs = allJobs.filter((j) => !specByJobId.has(j.id));

      expect(specJobs).toHaveLength(1);
      expect(specJobs[0]?.id).toBe('job-spec-1');
      const specMatch = specByJobId.get(specJobs[0]!.id);
      expect(specMatch).toBeDefined();
      expect(specMatch?.id).toBe('042');
      expect(specMatch?.spec.title).toBe('Integration tests for callback flow');

      expect(nonSpecJobs).toHaveLength(1);
      expect(nonSpecJobs[0]?.id).toBe('job-orphan-2');
      expect(nonSpecJobs[0]?.title).toBe('Standalone terminal run');

      const partitioned = partitionJobs(allJobs, useSpecsStore.getState().queues, '/work/my-repo');
      expect(partitioned.specJobs).toHaveLength(1);
      expect(partitioned.nonSpecJobs).toHaveLength(1);

      // When there are no orphan jobs, non-spec section is empty/hidden
      const allJobsOnlySpec = [jobFromSpec];
      const nonSpecEmpty = allJobsOnlySpec.filter((j) => !specByJobId.has(j.id));
      expect(nonSpecEmpty).toHaveLength(0);
    });

    it('labels a job by its spec when spec.changed with its jobId arrives after the job appeared', () => {
      const spec: SpecRun = {
        id: SpecId.parse('1'),
        queueId: 'q-test' as QueueId,
        position: 1,
        file: 'docs/specs/001-add-function.md',
        spec: {
          id: '1',
          title: 'Add an add function',
          depends_on: [],
          scope: ['src/**'],
          done_when: [{ by: 'audit', text: 'The goal is met' }],
          agent: 'auto',
          mode: 'single',
          agents: [],
        },
        state: 'queued',
        attempt: null,
        jobId: null,
        worktree: null,
        implementer: null,
        criteria: [],
        blockedBy: [],
        startedAt: null,
        finishedAt: null,
        tokens: 0,
        history: [],
      };

      const queue: SpecQueue = {
        id: 'q-test' as QueueId,
        repoPath: '/work/my-repo',
        paused: false,
        createdAt: '2026-10-11T09:00:00Z',
        settings: {
          source: 'docs/specs',
          order: 'waves',
          advance: 'verified',
          retries: 2,
          on_fail: 'retry-stop',
          max_parallel: 2,
          after_each: [],
        },
        specs: [spec],
      };

      const job: Job = {
        id: 'job-1' as JobId,
        title: 'Spec 1 job',
        status: 'running',
        spec: {
          mode: 'single',
          goal: 'Add an add function',
          repoPath: '/work/my-repo',
          checks: [],
          onLimit: 'switch-account',
          orchestrator: { agent: 'claude', account: 'auto' },
          workers: ['codex'],
        },
        step: null,
        createdAt: '2026-10-11T10:00:00Z',
        scheduledFor: null,
      };

      // 1. Initial state: queue is in store with no jobId on spec 1 yet
      useSpecsStore.getState().upsertQueue(queue);

      // 2. Job starts and job.changed arrives first: job is not yet linked by jobId
      useJobsStore.getState().upsertJob(job);

      const before = partitionJobs(useJobsStore.getState().jobs, useSpecsStore.getState().queues, '/work/my-repo');
      expect(before.specJobs).toHaveLength(0);
      expect(before.nonSpecJobs).toHaveLength(1);
      expect(before.nonSpecJobs[0]?.id).toBe('job-1');

      // 3. Runner emits spec.changed with the new jobId once started
      const updatedSpec: SpecRun = {
        ...spec,
        state: 'running',
        attempt: 1,
        jobId: 'job-1' as JobId,
        startedAt: '2026-10-11T10:00:01Z',
      };
      applyOrchEvent({ type: 'spec.changed', spec: updatedSpec });

      // 4. Job is re-grouped into specJobs and labelled with spec id and title
      const after = partitionJobs(useJobsStore.getState().jobs, useSpecsStore.getState().queues, '/work/my-repo');
      expect(after.nonSpecJobs).toHaveLength(0);
      expect(after.specJobs).toHaveLength(1);
      expect(after.specJobs[0]?.id).toBe('job-1');
      const matched = after.specForJob(after.specJobs[0]!);
      expect(matched).toBeDefined();
      expect(matched?.id).toBe('1');
      expect(matched?.spec.title).toBe('Add an add function');
    });
  });

  describe('Watch live opens the spec\'s job run', () => {
    it('switches to Specs Live view, expands the spec\'s job, and opens its first active run in the focused pane', () => {
      const jobId = 'job-spec-42' as JobId;
      const run1 = sampleRun({
        id: 'r-01' as RunId,
        jobId,
        agent: 'codex',
        accountId: AccountId.parse('codex-1'),
        status: 'done',
        worktree: WorktreeId.parse('orch/spec-42'),
        startedAt: '2026-10-11T10:00:00Z',
      });
      const run2 = sampleRun({
        id: 'r-02' as RunId,
        jobId,
        agent: 'codex',
        accountId: AccountId.parse('codex-1'),
        status: 'running',
        worktree: WorktreeId.parse('orch/spec-42'),
        startedAt: '2026-10-11T10:05:00Z',
      });

      useRunsStore.getState().upsertRun(run1);
      useRunsStore.getState().upsertRun(run2);

      // Trigger Watch live flow (switches to Specs Live + openJobRun)
      useWorkbenchStore.getState().setActiveArea('specs');
      useSpecsUiStore.getState().setView('live');
      openJobRun(jobId);

      expect(useWorkbenchStore.getState().activeArea).toBe('specs');
      expect(useSpecsUiStore.getState().view).toBe('live');
      expect(useSidebarStore.getState().openJobs[jobId]).toBe(true);

      // Preferred active run 'r-02' was opened in the focused pane
      const paneState = usePanesStore.getState();
      const focusedTabs = paneState.focused === 'A' ? paneState.tabsA : paneState.tabsB;
      const focusedActive = paneState.focused === 'A' ? paneState.activeA : paneState.activeB;
      expect(focusedTabs).toContain('r-02');
      expect(focusedActive).toBe('r-02');
    });

    it('falls back to the first run if no run is currently running', () => {
      const jobId = 'job-spec-99' as JobId;
      const runDone = sampleRun({
        id: 'r-done' as RunId,
        jobId,
        agent: 'claude',
        accountId: AccountId.parse('claude-1'),
        status: 'done',
        worktree: WorktreeId.parse('orch/spec-99'),
        startedAt: '2026-10-11T10:00:00Z',
      });

      useRunsStore.getState().upsertRun(runDone);

      openJobRun(jobId);

      expect(useSidebarStore.getState().openJobs[jobId]).toBe(true);
      const paneState = usePanesStore.getState();
      const focusedTabs = paneState.focused === 'A' ? paneState.tabsA : paneState.tabsB;
      const focusedActive = paneState.focused === 'A' ? paneState.activeA : paneState.activeB;
      expect(focusedTabs).toContain('r-done');
      expect(focusedActive).toBe('r-done');
    });
  });
});
