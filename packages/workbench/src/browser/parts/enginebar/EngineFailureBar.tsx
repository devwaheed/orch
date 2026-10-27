import { engineKeepsStopping, useEngineStore } from '../../services/stores/engine.js';
import { workbenchRegistry } from '../../services/registry.js';
import { shellStrings } from '../strings.js';

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
    <aside
      className="flex items-center gap-4 py-3 px-7 bg-err-bg border-b border-err-line text-err text-sm z-[5]"
      role="alert"
    >
      <span className="flex-auto font-medium">{S.keepsStopping}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 min-h-[28px] px-4 py-1 border border-err-line rounded-sm bg-raised text-text text-xs font-medium cursor-pointer hover:bg-active"
          onClick={onRestart}
        >
          {S.restartEngine}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 min-h-[28px] px-4 py-1 border border-err-line rounded-sm bg-transparent text-err text-xs font-medium cursor-pointer hover:bg-err-bg hover:border-err"
          onClick={() => workbenchRegistry.runCommand('bugreport.open')}
        >
          {S.reportProblem}
        </button>
      </div>
    </aside>
  );
}
