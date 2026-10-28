import { describe, expect, it, vi } from 'vitest';
import { stopResumedWorkflows } from './engineHost.js';

describe('engine restart workflow cleanup', () => {
  it('cancels active disk-resumed workflows and logs only their ids', async () => {
    const workflowStatus = vi.fn((workflow: string) => ({
      state: workflow === 'wf-live' ? 'running' : 'completed',
    } as ReturnType<Parameters<typeof stopResumedWorkflows>[0]['workflowStatus']>));
    const workflowCancel = vi.fn(() => ({ cancelled: true }));
    const log = vi.fn();

    await stopResumedWorkflows({ workflowStatus, workflowCancel } as Parameters<typeof stopResumedWorkflows>[0], ['wf-live', 'wf-done'], log);

    expect(workflowCancel).toHaveBeenCalledTimes(1);
    expect(workflowCancel).toHaveBeenCalledWith('wf-live');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('wf-live');
  });
});
