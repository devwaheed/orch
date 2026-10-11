import { useEffect } from 'react';
import { Command } from 'cmdk';
import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { workbenchRegistry } from '../../services/registry.js';
import { shellStrings } from '../strings.js';
import styles from './CommandPalette.module.css';

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

  const commands = workbenchRegistry.getCommands();

  const handleSelect = (cmdId: string) => {
    const found = commands.find((c) => c.id === cmdId);
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
