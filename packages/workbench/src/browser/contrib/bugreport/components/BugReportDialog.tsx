import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { useBugReportUiStore } from '../stores/bugReportUi.js';
import { bugReportStrings as S } from '../strings.js';
import { loadBugReportFiles, saveBugReport } from '../actions.js';
import { bugReportServices } from '../services.js';

const SECONDARY_BUTTON =
  'min-h-[38px] px-6 py-3 border border-btnline rounded-md bg-btn text-base text-text cursor-pointer disabled:cursor-default disabled:opacity-50';
const PRIMARY_BUTTON =
  'min-h-[38px] px-6 py-3 border-0 rounded-md bg-accent-solid text-base font-semibold text-on-accent cursor-pointer disabled:cursor-default disabled:bg-raised disabled:text-disabled';

export function BugReportDialog() {
  const open = useBugReportUiStore((s) => s.open);
  const files = useBugReportUiStore((s) => s.files);
  const loadingFiles = useBugReportUiStore((s) => s.loadingFiles);
  const saving = useBugReportUiStore((s) => s.saving);
  const savedPath = useBugReportUiStore((s) => s.savedPath);
  const error = useBugReportUiStore((s) => s.error);
  const closeDialog = useBugReportUiStore((s) => s.closeDialog);

  const activeProject = useWorkbenchStore((s) => s.activeProject);

  useEffect(() => {
    if (!open) return undefined;
    const services = bugReportServices();
    if (services) {
      void loadBugReportFiles(services.bugreport);
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDialog();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeDialog]);

  if (!open) return null;

  const onSave = () => {
    const services = bugReportServices();
    if (!services || !window.orch) return;
    void saveBugReport({
      bugreport: services.bugreport,
      activeProject,
      showItemInFolder: (path) => window.orch!.app.showItemInFolder(path),
      openNewIssue: () => window.orch!.app.openNewIssue(),
    });
  };

  const onShowInFolder = () => {
    if (savedPath && window.orch) {
      void window.orch.app.showItemInFolder(savedPath);
    }
  };

  const onOpenIssue = () => {
    if (window.orch) {
      void window.orch.app.openNewIssue();
    }
  };

  return (
    <div className="fixed inset-0 z-[99]">
      <button
        type="button"
        className="absolute inset-0 w-full h-full border-0 bg-overlay cursor-default"
        aria-label={S.dialog.close}
        onClick={closeDialog}
      />
      <div
        role="dialog"
        aria-label={S.dialog.ariaLabel}
        className="absolute top-[70px] left-1/2 -translate-x-1/2 w-[min(600px,calc(100%-32px))] border border-btnline rounded-2xl bg-panel shadow-dialog overflow-hidden"
      >
        <div className="flex items-center gap-5 px-8 py-7 border-b border-line2">
          <h2 className="m-0 flex-auto text-lg font-semibold">{S.dialog.title}</h2>
          <button
            type="button"
            className="flex items-center justify-center w-[32px] h-[32px] min-h-hit-min rounded-md border-0 bg-transparent text-text3 cursor-pointer hover:bg-raised"
            aria-label={S.dialog.close}
            onClick={closeDialog}
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-5 p-8">
          <p
            className="m-0 text-base text-muted leading-(--dialog-leading)"
            style={{ '--dialog-leading': '1.5' } as CSSProperties}
          >
            {S.dialog.intro}
          </p>

          <div className="flex flex-col gap-2 max-h-[200px] overflow-y-auto px-5 py-4 border border-line2 rounded-lg bg-panel2">
            {loadingFiles ? (
              <p className="m-0 text-sm text-muted2">{S.dialog.loadingFiles}</p>
            ) : files.length === 0 ? (
              <p className="m-0 text-sm text-muted2">{S.dialog.noFiles}</p>
            ) : (
              files.map((file) => (
                <div key={file} className="flex items-center gap-3 text-xs text-text2 font-mono">
                  <Icon name="file" size={13} className="shrink-0 text-faint" />
                  <span>{file}</span>
                </div>
              ))
            )}
          </div>

          {savedPath && (
            <div className="flex flex-col gap-4 p-5 rounded-lg bg-ok-bg">
              <div className="flex items-center gap-3 text-sm text-ok font-semibold">
                <Icon name="check" size={16} />
                <span>{S.dialog.savedTo(savedPath)}</span>
              </div>
              <div className="flex flex-wrap gap-3 mt-2">
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  onClick={onShowInFolder}
                >
                  <Icon name="folder" size={14} />
                  <span>{S.dialog.showInFolder}</span>
                </button>
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  onClick={onOpenIssue}
                >
                  <Icon name="link" size={14} />
                  <span>{S.dialog.openGitHubIssue}</span>
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="flex flex-col gap-2 px-5 py-4 border border-err-line rounded-lg bg-err-bg text-sm text-err" role="alert">
              <span className="font-semibold">{error.message}</span>
              {error.fix && <span className="text-xs text-text2">{error.fix}</span>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-8 py-6 border-t border-line2 bg-panel2">
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={closeDialog}
          >
            {S.dialog.cancel}
          </button>
          {!savedPath && (
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={saving || loadingFiles}
              onClick={onSave}
            >
              {saving ? S.dialog.saving : S.dialog.saveReport}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
