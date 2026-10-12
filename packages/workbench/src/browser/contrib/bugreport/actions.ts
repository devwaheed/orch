/**
 * Bug report dialog actions.
 */
import type { IBugReportService } from '@orchagents/contracts';
import { useBugReportUiStore } from './stores/bugReportUi.js';

export interface BugReportEnvironment {
  readonly bugreport: IBugReportService;
  readonly activeProject?: string;
  readonly showItemInFolder: (path: string) => Promise<void>;
  readonly openNewIssue: () => Promise<void>;
}

export async function loadBugReportFiles(service: IBugReportService): Promise<void> {
  const store = useBugReportUiStore.getState();
  store.setLoadingFiles(true);
  store.setError(null);

  const res = await service.files();
  if (res.ok) {
    store.setFiles(res.value);
  } else {
    store.setError(res.error);
    store.setLoadingFiles(false);
  }
}

export async function saveBugReport(env: BugReportEnvironment): Promise<void> {
  const store = useBugReportUiStore.getState();
  store.setSaving(true);
  store.setError(null);

  const repoPath = env.activeProject ? env.activeProject : undefined;
  const res = await env.bugreport.save({ repoPath });

  if (res.ok) {
    const savedPath = res.value.path;
    store.setSavedPath(savedPath);
    // LOCKED BUG-02: "The app reveals it in the file manager"
    try {
      await env.showItemInFolder(savedPath);
    } catch {
      // reveal failure does not invalidate the saved bundle
    }
  } else {
    store.setError(res.error);
  }
}
