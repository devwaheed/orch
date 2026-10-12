import { useEffect } from 'react';
import { Command } from 'cmdk';
import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { workbenchRegistry } from '../../services/registry.js';
import { shellStrings } from '../strings.js';
import styles from './CommandPalette.module.css';
import type { PaletteCommandContribution } from '../../services/registry.js';

const DEMO_COMMANDS: readonly PaletteCommandContribution[] = [
  { id: 'work.demoResume', title: 'Resume s-91e0 on Codex · Team', hint: 'session', icon: 'swap', order: 0, action: () => undefined },
  { id: 'shell.review', title: 'Review changes ready to merge', hint: '⌘3', icon: 'review', order: 1, action: () => undefined },
  { id: 'shell.sessions', title: 'Show resumable sessions', hint: '⌘4', icon: 'history', order: 2, action: () => undefined },
  { id: 'shell.split', title: 'Close split view', hint: '⌘\\', icon: 'split', order: 3, action: () => undefined },
  { id: 'shell.newJob', title: 'New job', hint: '⌘N', icon: 'plus', order: 4, action: () => undefined },
  { id: 'accounts.add', title: 'Add an account', icon: 'plus', order: 5, action: () => undefined },
  { id: 'shell.accounts', title: 'Account settings', hint: '⌘6', icon: 'users', order: 6, action: () => undefined },
  { id: 'shell.terminal', title: 'Hide terminal', hint: '⌃`', icon: 'terminal', order: 7, action: () => undefined },
  { id: 'shell.theme', title: 'Switch to light theme', icon: 'sun', order: 8, action: () => undefined },
  { id: 'shell.capacity', title: 'Show capacity panel', hint: '⌘B', icon: 'panelRight', order: 9, action: () => undefined },
];

export function CommandPalette() {
  const paletteOpen = useWorkbenchStore((s) => s.paletteOpen);
  const closePalette = useWorkbenchStore((s) => s.closePalette);

  useEffect(() => {
    if (!paletteOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [paletteOpen, closePalette]);

  if (!paletteOpen) {
    return null;
  }

  const demo = window.orch?.app.demo === true;
  const commands = demo ? DEMO_COMMANDS : workbenchRegistry.getCommands();

  const handleSelect = (cmdId: string) => {
    const found = (demo ? workbenchRegistry.getCommands() : commands).find((c) => c.id === cmdId);
    if (found) {
      closePalette();
      void found.action();
    }
  };

  return (
    <div className={styles.overlay}>
      <button
        type="button"
        onClick={closePalette}
        aria-label={shellStrings.palette.closeAriaLabel}
        className={styles.backdrop}
      />
      <div
        role="dialog"
        aria-label={shellStrings.palette.dialogAriaLabel}
        className={styles.dialog}
      >
        <Command label={shellStrings.palette.dialogAriaLabel}>
          <div className={styles.header}>
            <Icon name="search" size={16} weight={1.9} className={styles.searchIcon ?? ''} />
            <Command.Input
              autoFocus
              className={styles.input}
              placeholder={shellStrings.palette.inputPlaceholder}
              aria-label={shellStrings.palette.inputAriaLabel}
            />
            <span className={styles.escBadge}>{shellStrings.palette.escHint}</span>
          </div>

          <Command.List className={styles.list}>
            <Command.Empty className={styles.empty}>
              {shellStrings.palette.noResults}
            </Command.Empty>

            {commands.map((cmd) => (
              <Command.Item
                key={cmd.id}
                value={`${cmd.title} ${cmd.category ?? ''}`}
                onSelect={() => handleSelect(cmd.id)}
                className={styles.item}
                data-demo={demo ? 'true' : undefined}
              >
                {cmd.icon && (
                  <Icon
                    name={cmd.icon}
                    size={15}
                    weight={1.9}
                    className={styles.itemIcon ?? ''}
                  />
                )}
                <span className={styles.itemLabel}>{cmd.title}</span>
                {cmd.hint && <span className={styles.itemHint}>{cmd.hint}</span>}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
