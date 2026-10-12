import { useEffect } from 'react';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../../services/workbenchStore.js';
import { useBugReportUiStore } from '../stores/bugReportUi.js';
import { bugReportStrings as S } from '../strings.js';
import { loadBugReportFiles, saveBugReport } from '../actions.js';
import { bugReportServices } from '../services.js';
import styles from './BugReportDialog.module.css';

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
    <div className={styles.overlay}>
      <button
        type="button"
        className={styles.scrim}
        aria-label={S.dialog.close}
        onClick={closeDialog}
      />
      <div
        role="dialog"
        aria-label={S.dialog.ariaLabel}
        className={styles.dialog}
      >
        <div className={styles.dialogHead}>
          <h2 className={styles.dialogTitle}>{S.dialog.title}</h2>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={S.dialog.close}
            onClick={closeDialog}
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className={styles.dialogBody}>
          <p className={styles.dialogText}>{S.dialog.intro}</p>

          <div className={styles.fileListContainer}>
            {loadingFiles ? (
              <p className={styles.emptyText}>{S.dialog.loadingFiles}</p>
            ) : files.length === 0 ? (
              <p className={styles.emptyText}>{S.dialog.noFiles}</p>
            ) : (
              files.map((file) => (
                <div key={file} className={styles.fileItem}>
                  <Icon name="file" size={13} className={styles.fileItemIcon ?? ''} />
                  <span>{file}</span>
                </div>
              ))
            )}
          </div>

          {savedPath && (
            <div className={styles.savedBlock}>
              <div className={styles.savedMessage}>
                <Icon name="check" size={16} />
                <span>{S.dialog.savedTo(savedPath)}</span>
              </div>
              <div className={styles.savedActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={onShowInFolder}
                >
                  <Icon name="folder" size={14} />
                  <span>{S.dialog.showInFolder}</span>
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={onOpenIssue}
                >
                  <Icon name="link" size={14} />
                  <span>{S.dialog.openGitHubIssue}</span>
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className={styles.errorBlock} role="alert">
              <span className={styles.errorMessage}>{error.message}</span>
              {error.fix && <span className={styles.errorFix}>{error.fix}</span>}
            </div>
          )}
        </div>

        <div className={styles.dialogFoot}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={closeDialog}
          >
            {S.dialog.cancel}
          </button>
          {!savedPath && (
            <button
              type="button"
              className={styles.primaryButton}
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
