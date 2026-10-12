import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@orchagents/base';
import type { IBugReportService, OrchError } from '@orchagents/contracts';
import {
  loadBugReportFiles,
  saveBugReport,
  type BugReportEnvironment,
} from '../src/browser/contrib/bugreport/actions.js';
import { useBugReportUiStore } from '../src/browser/contrib/bugreport/stores/bugReportUi.js';
import { engineKeepsStopping, useEngineStore } from '../src/browser/services/stores/engine.js';

describe('Bug report area and dialog flow (BUG-01, BUG-02, BUG-04)', () => {
  beforeEach(() => {
    useBugReportUiStore.getState().closeDialog();
    useBugReportUiStore.setState({
      files: [],
      loadingFiles: false,
      saving: false,
      savedPath: null,
      error: null,
    });
  });

  it('loads file list from service and updates store', async () => {
    const fakeService: IBugReportService = {
      files: vi.fn().mockResolvedValue(ok(['~/.orch/logs/engine.log', '~/.orch/config.json'])),
      save: vi.fn(),
    };

    await loadBugReportFiles(fakeService);

    expect(fakeService.files).toHaveBeenCalledTimes(1);
    const state = useBugReportUiStore.getState();
    expect(state.files).toEqual(['~/.orch/logs/engine.log', '~/.orch/config.json']);
    expect(state.loadingFiles).toBe(false);
    expect(state.error).toBeNull();
  });

  it('handles file list error from service', async () => {
    const serviceError: OrchError = {
      code: 'internal',
      message: 'Failed to inspect files',
      fix: 'Check directory permissions',
    };
    const fakeService: IBugReportService = {
      files: vi.fn().mockResolvedValue(err(serviceError)),
      save: vi.fn(),
    };

    await loadBugReportFiles(fakeService);

    const state = useBugReportUiStore.getState();
    expect(state.files).toEqual([]);
    expect(state.error).toEqual(serviceError);
  });

  it('saves bug report, reveals in folder, and transitions to saved state', async () => {
    const fakeService: IBugReportService = {
      files: vi.fn(),
      save: vi.fn().mockResolvedValue(ok({ path: '/tmp/orch-bugreport-123.zip', bytes: 4096 })),
    };
    const showItemInFolder = vi.fn().mockResolvedValue(undefined);
    const openNewIssue = vi.fn().mockResolvedValue(undefined);

    const env: BugReportEnvironment = {
      bugreport: fakeService,
      activeProject: '/projects/my-app',
      showItemInFolder,
      openNewIssue,
    };

    await saveBugReport(env);

    expect(fakeService.save).toHaveBeenCalledWith({ repoPath: '/projects/my-app' });
    expect(showItemInFolder).toHaveBeenCalledWith('/tmp/orch-bugreport-123.zip');

    const state = useBugReportUiStore.getState();
    expect(state.saving).toBe(false);
    expect(state.savedPath).toBe('/tmp/orch-bugreport-123.zip');
    expect(state.error).toBeNull();
  });

  it('sets error state when save fails', async () => {
    const saveError: OrchError = {
      code: 'internal',
      message: 'Failed to write zip archive',
      fix: 'Ensure there is sufficient disk space',
    };
    const fakeService: IBugReportService = {
      files: vi.fn(),
      save: vi.fn().mockResolvedValue(err(saveError)),
    };
    const showItemInFolder = vi.fn();
    const openNewIssue = vi.fn();

    const env: BugReportEnvironment = {
      bugreport: fakeService,
      showItemInFolder,
      openNewIssue,
    };

    await saveBugReport(env);

    expect(showItemInFolder).not.toHaveBeenCalled();
    const state = useBugReportUiStore.getState();
    expect(state.saving).toBe(false);
    expect(state.savedPath).toBeNull();
    expect(state.error).toEqual(saveError);
  });

});

describe('Engine failure bar and restarting state (ENG-07)', () => {
  it('tracks restarting state in engine store', () => {
    useEngineStore.setState({ state: 'restarting', message: null });
    expect(useEngineStore.getState().state).toBe('restarting');
  });

  it('tracks failed state in engine store', () => {
    useEngineStore.setState({ state: 'failed', message: 'Engine process exited repeatedly' });
    expect(useEngineStore.getState().state).toBe('failed');
  });

  it('keeps the engine bar up between automatic retries until the engine is ready (ENG-07)', () => {
    expect(engineKeepsStopping({ state: 'failed', message: 'The engine keeps stopping' })).toBe(true);
    expect(engineKeepsStopping({ state: 'starting', message: 'The engine keeps stopping' })).toBe(true);
    expect(engineKeepsStopping({ state: 'restarting', message: null })).toBe(false);
    expect(engineKeepsStopping({ state: 'ready', message: 'The engine keeps stopping' })).toBe(false);
  });
});
