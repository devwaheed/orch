/**
 * The terminal dock (S2-06): shell tabs, add, close and hide, and one xterm per tab.
 * Shown under the Work area with ⌃` (UI-05). Hiding keeps the shells running.
 */
import React, { useEffect, useRef } from 'react';
import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { useThemeStore } from '../../services/theme.js';
import { getTerminalController } from './terminalService.js';
import type { TerminalController } from './terminalController.js';
import { useTerminalStore } from './terminalStore.js';
import { canRestart, type TerminalTab } from './terminalTabs.js';
import { terminalStrings } from './strings.js';
import styles from './TerminalDock.module.css';

export function TerminalDock() {
  const open = useWorkbenchStore((s) => s.terminalOpen);
  const toggleTerminal = useWorkbenchStore((s) => s.toggleTerminal);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const tabs = useTerminalStore((s) => s.tabs);
  const activeKey = useTerminalStore((s) => s.activeKey);
  const controller = getTerminalController();

  // Opening the dock with no tab starts a shell in the project folder (prototype: toggleDock).
  useEffect(() => {
    if (open && tabs.length === 0) controller?.openTab();
  }, [open, tabs.length, controller]);

  useEffect(() => {
    controller?.refreshThemes();
  }, [resolvedTheme, controller]);

  return (
    <section aria-label={terminalStrings.dockTitle} className={styles.dock} hidden={!open}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="terminal" size={13} weight={2} />
          {terminalStrings.dockTitle}
        </span>
        <div className={styles.tabs}>
          {tabs.map((tab) => (
            <div key={tab.key} className={tab.key === activeKey ? `${styles.tab} ${styles.tabActive}` : styles.tab}>
              <button
                type="button"
                aria-pressed={tab.key === activeKey}
                onClick={() => controller?.selectTab(tab.key)}
                className={styles.tabButton}
              >
                <Icon name="branch" size={11} weight={2} />
                {tab.label}
              </button>
              <button
                type="button"
                aria-label={terminalStrings.closeShell(tab.label)}
                onClick={() => controller?.closeTab(tab.key)}
                className={styles.tabClose}
              >
                <Icon name="close" size={10} weight={2.4} />
              </button>
            </div>
          ))}
          <button
            type="button"
            aria-label={terminalStrings.newShell}
            title={terminalStrings.newShellTitle}
            onClick={() => controller?.openTab()}
            className={styles.iconButton}
          >
            <Icon name="plus" size={12} weight={2.2} />
          </button>
        </div>
        <span className={styles.hint}>{terminalStrings.dockHint}</span>
        <button
          type="button"
          aria-label={terminalStrings.hideTerminal}
          onClick={toggleTerminal}
          className={styles.iconButton}
        >
          <Icon name="chevDown" size={12} weight={2.2} />
        </button>
      </div>
      <div className={styles.body}>
        {tabs.map((tab) => (
          <TerminalPane key={tab.key} tab={tab} active={tab.key === activeKey} controller={controller} />
        ))}
      </div>
    </section>
  );
}

interface TerminalPaneProps {
  readonly tab: TerminalTab;
  readonly active: boolean;
  readonly controller: TerminalController | null;
}

function TerminalPane({ tab, active, controller }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !controller) return undefined;
    return controller.attach(tab.key, host);
  }, [controller, tab.key]);

  return (
    <div className={styles.pane} hidden={!active}>
      {tab.status === 'stopped' && (
        <div role="status" className={styles.notice}>
          <span>{terminalStrings.stopped.message}</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className={styles.restart}
            disabled={!canRestart(tab)}
            onClick={() => controller?.restartTab(tab.key)}
          >
            {terminalStrings.stopped.fix}
          </button>
        </div>
      )}
      {tab.status === 'failed' && (
        <div role="alert" className={styles.notice}>
          <span>{terminalStrings.openFailed.message}</span>
          <span>{terminalStrings.openFailed.fix}</span>
        </div>
      )}
      <div ref={hostRef} className={styles.host} />
    </div>
  );
}
