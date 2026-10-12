import { engineKeepsStopping, useEngineStore } from '../../services/stores/engine.js';
import { workbenchRegistry } from '../../services/registry.js';
import { shellStrings } from '../strings.js';
import styles from './EngineFailureBar.module.css';

const S = shellStrings.engineBar;

export function EngineFailureBar() {
  const keepsStopping = useEngineStore(engineKeepsStopping);

  if (!keepsStopping) return null;

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
          onClick={() => workbenchRegistry.runCommand('bugreport.open')}
        >
          {S.reportProblem}
        </button>
      </div>
    </aside>
  );
}
