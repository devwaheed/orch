import { useEngineStore } from '../../services/stores/engine.js';
import { useBugReportUiStore } from '../../contrib/bugreport/index.js';
import { shellStrings } from '../strings.js';
import styles from './EngineFailureBar.module.css';

const S = shellStrings.engineBar;

export function EngineFailureBar() {
  const engineState = useEngineStore((s) => s.state);
  const openBugReport = useBugReportUiStore((s) => s.openDialog);

  if (engineState !== 'failed') return null;

  const onRestart = () => {
    if (window.orch) {
      void window.orch.app.restartEngine();
    }
  };

  return (
    <aside className={styles.bar} role="alert">
      <span className={styles.text}>{S.keepsStopping}</span>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.restartButton}
          onClick={onRestart}
        >
          {S.restartEngine}
        </button>
        <button
          type="button"
          className={styles.reportButton}
          onClick={openBugReport}
        >
          {S.reportProblem}
        </button>
      </div>
    </aside>
  );
}
