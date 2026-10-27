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
import { cx } from '../cx.js';

// .tabClose, .iconButton — focus-visible outline is shared across the dock's buttons
const dockButtonClass =
  'flex items-center justify-center min-w-6 min-h-6 border-none cursor-pointer focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-[-2px]';

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
    <section
      aria-label={terminalStrings.dockTitle}
      hidden={!open}
      className={cx(
        'isolate flex-none border-t border-line bg-chrome',
        open ? 'flex flex-col' : 'hidden',
      )}
    >
      <div className="flex items-center gap-2px min-h-[36px] pl-5 pr-2 border-b border-line2">
        <span className="flex items-center gap-2 mr-3 text-xs font-semibold tracking-[0.06em] uppercase text-muted2">
          <Icon name="terminal" size={13} weight={2} />
          {terminalStrings.dockTitle}
        </span>
        <div className="flex flex-auto min-w-[0px] items-center gap-2px overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.key}
              className={cx('flex items-center rounded-sm', tab.key === activeKey ? 'bg-active' : 'bg-transparent')}
            >
              <button
                type="button"
                aria-pressed={tab.key === activeKey}
                onClick={() => controller?.selectTab(tab.key)}
                className={cx(
                  'flex items-center gap-2 min-h-[28px] pl-4 pr-1 border-none bg-transparent font-mono text-xs whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-[-2px]',
                  tab.key === activeKey ? 'text-text' : 'text-muted2',
                )}
              >
                <Icon name="branch" size={11} weight={2} />
                <span>{terminalStrings.shellName} · </span>
                {tab.label}
              </button>
              <button
                type="button"
                aria-label={terminalStrings.closeShell(tab.label)}
                onClick={() => controller?.closeTab(tab.key)}
                className={cx(dockButtonClass, 'rounded-5px bg-transparent text-faint')}
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
            className={cx(dockButtonClass, 'rounded-sm bg-transparent text-muted2')}
          >
            <Icon name="plus" size={12} weight={2.2} />
          </button>
        </div>
        <span className="px-2 text-xs text-faint whitespace-nowrap">{terminalStrings.dockHint}</span>
        <button
          type="button"
          aria-label={terminalStrings.hideTerminal}
          onClick={toggleTerminal}
          className={cx(dockButtonClass, 'rounded-sm bg-transparent text-muted2')}
        >
          <Icon name="chevDown" size={12} weight={2.2} />
        </button>
      </div>
      <div className="relative h-[190px] py-4 px-6 bg-term">
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
    <div
      className={active ? 'flex flex-col h-full' : 'hidden'}
      hidden={!active}
    >
      {tab.status === 'stopped' && (
        <div role="status" className="flex items-center gap-2 pb-2 text-xs text-muted2">
          <span>{terminalStrings.stopped.message}</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="min-h-[32px] px-2 border-none bg-transparent text-text text-xs underline cursor-pointer focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-[-2px]"
            disabled={!canRestart(tab)}
            onClick={() => controller?.restartTab(tab.key)}
          >
            {terminalStrings.stopped.fix}
          </button>
        </div>
      )}
      {tab.status === 'failed' && (
        <div role="alert" className="flex items-center gap-2 pb-2 text-xs text-muted2">
          <span>{terminalStrings.openFailed.message}</span>
          <span>{terminalStrings.openFailed.fix}</span>
        </div>
      )}
      <div ref={hostRef} className="flex-auto min-h-[0px] overflow-hidden tracking-[0px]" />
    </div>
  );
}
