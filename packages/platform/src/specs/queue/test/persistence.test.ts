import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { QueueId, SpecId, SpecQueue, SpecRun, Timestamp } from '@orchagents/contracts';
import { DEFAULT_SPEC_QUEUE_SETTINGS } from '../common/scheduler.js';
import { loadPersistedQueueState, recoverActiveSpecs, saveQueueState } from '../node/persistence.js';

describe('persistence & recovery (§9)', () => {
  const makeSpec = (id: string, state: SpecRun['state'] = 'queued', attempt: number | null = null): SpecRun => ({
    id: id as SpecId,
    queueId: 'q-test' as QueueId,
    position: 1,
    file: `docs/specs/${id}.md`,
    spec: {
      id,
      title: `Spec ${id}`,
      depends_on: [],
      scope: [],
      done_when: [{ by: 'audit', text: 'audit' }],
      agent: 'auto',
    },
    state,
    attempt,
    jobId: null,
    worktree: null,
    implementer: null,
    criteria: [],
    blockedBy: [],
    startedAt: null,
    finishedAt: null,
    tokens: 0,
  });

  const makeQueue = (repoPath: string, specs: SpecRun[] = []): SpecQueue => ({
    id: 'q-test' as QueueId,
    repoPath,
    paused: false,
    createdAt: new Date().toISOString() as Timestamp,
    settings: { ...DEFAULT_SPEC_QUEUE_SETTINGS },
    specs,
  });

  it('saves and loads queue state to .orch/queue-state.json', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-persist-'));
    try {
      const spec = makeSpec('1');
      const queue = makeQueue(tmp, [spec]);

      const saveRes = await saveQueueState(queue);
      expect(saveRes.ok).toBe(true);

      const loadRes = await loadPersistedQueueState(tmp);
      expect(loadRes.ok).toBe(true);
      expect(loadRes.ok && loadRes.value?.id).toBe(queue.id);
      expect(loadRes.ok && loadRes.value?.specs.length).toBe(1);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns null when no persisted state exists', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-persist-none-'));
    try {
      const loadRes = await loadPersistedQueueState(tmp);
      expect(loadRes.ok).toBe(true);
      expect(loadRes.ok && loadRes.value).toBeNull();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('recovers active specs whose engine workflows died to queued (§9)', () => {
    const specs: SpecRun[] = [
      makeSpec('1', 'running', 2),
      makeSpec('2', 'verified'),
    ];

    const { recoveredSpecs, changed } = recoverActiveSpecs(specs, () => false);
    expect(changed).toBe(true);
    expect(recoveredSpecs[0]?.state).toBe('queued');
    // Attempt count kept per §9
    expect(recoveredSpecs[0]?.attempt).toBe(2);
    expect(recoveredSpecs[1]?.state).toBe('verified');
  });
});
