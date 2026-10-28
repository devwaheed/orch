import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { useEngineStore } from '../../services/stores/engine.js';
import { workbenchRegistry } from '../../services/registry.js';
import { shellStrings } from '../strings.js';
import { cx } from '../cx.js';

export function StatusBar() {
  const engineHealthy = useWorkbenchStore((s) => s.engineHealthy);
  const engineState = useEngineStore((s) => s.state);
  const currentBranch = useWorkbenchStore((s) => s.currentBranch);
  const terminalOpen = useWorkbenchStore((s) => s.terminalOpen);
  const toggleTerminal = useWorkbenchStore((s) => s.toggleTerminal);
  const statusRuns = useWorkbenchStore((s) => s.statusRuns);
  const limitedAccount = useWorkbenchStore((s) => s.limitedAccount);
  const signedOutCount = useWorkbenchStore((s) => s.signedOutCount);
  const setCapacityOpen = useWorkbenchStore((s) => s.setCapacityOpen);
  const openPalette = useWorkbenchStore((s) => s.openPalette);

  const leftItems = workbenchRegistry.getStatusItems('left');
  const rightItems = workbenchRegistry.getStatusItems('right');

  const handleLimitClick = () => {
    setCapacityOpen(true);
  };

  const isRestarting = engineState === 'restarting';
  const dotBgClass = isRestarting
    ? 'bg-warn-solid'
    : engineHealthy
      ? 'bg-ok-dot'
      : 'bg-err-dot';
  const engineLabel = isRestarting
    ? shellStrings.statusBar.engineRestarting
    : shellStrings.statusBar.engineName;

  return (
    <footer
      aria-label="Status bar"
      className="flex flex-wrap items-center gap-x-7 gap-y-1 px-5 min-h-statusbar-h border-t border-line bg-chrome2 text-muted text-11px"
    >
      <span className="flex items-center gap-2">
        <span className={cx('w-[7px] h-[7px] [border-radius:50%]', dotBgClass)} />
        <span>{engineLabel}</span>
      </span>

      <span className="flex items-center gap-5px">
        <Icon name="branch" size={12} weight={2} />
        <span>{currentBranch}</span>
      </span>

      <button
        type="button"
        onClick={toggleTerminal}
        aria-pressed={terminalOpen}
        aria-label={shellStrings.statusBar.toggleTerminalAria}
        className={cx(
          'flex items-center gap-5px px-2 py-2px min-h-[22px] rounded-xs border-0 text-muted text-11px cursor-pointer hover:bg-raised hover:text-text',
          terminalOpen && 'bg-active text-text',
        )}
      >
        <Icon name="terminal" size={11} weight={2.2} />
        <span>{shellStrings.statusBar.terminal}</span>
      </button>

      <span>{statusRuns}</span>

      {limitedAccount && (
        <button
          type="button"
          onClick={handleLimitClick}
          className="flex items-center gap-5px px-2 py-2px min-h-[22px] rounded-xs border-0 bg-warn-bg text-warn text-11px cursor-pointer hover:opacity-90"
        >
          <Icon name="clock" size={11} weight={2.2} />
          <span>{limitedAccount.text}</span>
        </button>
      )}

      {leftItems.map((item) => (
        <span key={item.id}>{item.render()}</span>
      ))}

      <span className="flex-auto" />

      {signedOutCount > 0 && (
        <span>{shellStrings.statusBar.signedOutStatus(signedOutCount)}</span>
      )}

      {rightItems.map((item) => (
        <span key={item.id}>{item.render()}</span>
      ))}

      <button
        type="button"
        onClick={openPalette}
        className="px-2 py-2px min-h-[22px] rounded-xs border-0 bg-transparent text-muted text-11px cursor-pointer hover:bg-raised hover:text-text"
      >
        {shellStrings.statusBar.paletteCommandsHint}
      </button>
    </footer>
  );
}
