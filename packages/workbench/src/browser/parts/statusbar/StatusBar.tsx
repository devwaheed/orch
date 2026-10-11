import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { workbenchRegistry } from '../../services/registry.js';
import { shellStrings } from '../strings.js';
import styles from './StatusBar.module.css';

export function StatusBar() {
  const engineHealthy = useWorkbenchStore((s) => s.engineHealthy);
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

  return (
    <footer className={styles.statusBar}>
      <span className={styles.engineHealth}>
        <span
          className={engineHealthy ? styles.engineDot : styles.engineDotOffline}
        />
        <span>{shellStrings.statusBar.engineName}</span>
      </span>

      <span className={styles.branch}>
        <Icon name="branch" size={12} weight={2} />
        <span>{currentBranch}</span>
      </span>

      <button
        type="button"
        onClick={toggleTerminal}
        aria-pressed={terminalOpen}
        aria-label={shellStrings.statusBar.toggleTerminalAria}
        className={`${styles.terminalButton} ${terminalOpen ? styles.terminalButtonActive : ''}`}
      >
        <Icon name="terminal" size={11} weight={2.2} />
        <span>{shellStrings.statusBar.terminal}</span>
      </button>

      <span>{statusRuns}</span>

      {limitedAccount && (
        <button
          type="button"
          onClick={handleLimitClick}
          className={styles.limitButton}
        >
          <Icon name="clock" size={11} weight={2.2} />
          <span>{limitedAccount.text}</span>
        </button>
      )}

      {leftItems.map((item) => (
        <span key={item.id}>{item.render()}</span>
      ))}

      <span className={styles.spacer} />

      {signedOutCount > 0 && (
        <span>{shellStrings.statusBar.signedOutStatus(signedOutCount)}</span>
      )}

      {rightItems.map((item) => (
        <span key={item.id}>{item.render()}</span>
      ))}

      <button
        type="button"
        onClick={openPalette}
        className={styles.paletteHintButton}
      >
        {shellStrings.statusBar.paletteCommandsHint}
      </button>
    </footer>
  );
}
