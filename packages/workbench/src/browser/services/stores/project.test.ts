import { beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@orch/contracts';
import { useWorkbenchStore } from '../workbenchStore.js';
import { syncActiveProject } from './project.js';
import { useJobsStore } from './work.js';

const job = (repoPath: string, createdAt: string) => ({ spec: { repoPath }, createdAt }) as Job;

describe('active project', () => {
  beforeEach(() => {
    useWorkbenchStore.getState().setActiveProject('');
    useJobsStore.setState({ jobs: [] });
  });

  it('starts from the most recent job repo when nothing is chosen', () => {
    useJobsStore.setState({ jobs: [job('/a', '2026-10-11T10:00:00Z'), job('/b', '2026-10-11T11:00:00Z')] });
    syncActiveProject();
    expect(useWorkbenchStore.getState().activeProject).toBe('/b');
  });

  it('a folder chosen in the picker is not replaced when jobs change', () => {
    useWorkbenchStore.getState().setActiveProject('/chosen');
    useJobsStore.setState({ jobs: [job('/b', '2026-10-11T11:00:00Z')] });
    syncActiveProject();
    expect(useWorkbenchStore.getState().activeProject).toBe('/chosen');
  });
});
