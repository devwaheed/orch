import { useEffect, useRef } from 'react';
import { Command } from 'cmdk';
import { Icon } from '../../../../../../design/icons/Icon.js';
import { useWorkbenchStore } from '../../services/workbenchStore.js';
import { workbenchRegistry } from '../../services/registry.js';
import { shellStrings } from '../strings.js';
import type { PaletteCommandContribution } from '../../services/registry.js';
import { useDialogFocusTrap } from '../../services/dialogFocus.js';

const DEMO_COMMANDS: readonly PaletteCommandContribution[] = [
  { id: 'work.demoResume', title: 'Resume s-91e0 on Codex · Team', hint: 'session', icon: 'swap', order: 0, action: () => undefined },
  { id: 'shell.review', title: 'Review changes ready to merge', hint: '⌘2', icon: 'review', order: 1, action: () => undefined },
  { id: 'shell.sessions', title: 'Show resumable sessions', hint: '⌘3', icon: 'history', order: 2, action: () => undefined },
  { id: 'shell.split', title: 'Close split view', hint: '⌘\\', icon: 'split', order: 3, action: () => undefined },
  { id: 'shell.newJob', title: 'New spec', hint: '⌘N', icon: 'plus', order: 4, action: () => undefined },
  { id: 'product.new', title: shellStrings.titleBar.newProduct, icon: 'plus', order: 4.5, category: 'New', action: () => undefined },
  { id: 'accounts.add', title: 'Add an account', icon: 'plus', order: 5, action: () => undefined },
  { id: 'shell.accounts', title: 'Account settings', hint: '⌘5', icon: 'users', order: 6, action: () => undefined },
  { id: 'shell.terminal', title: 'Hide terminal', hint: '⌃`', icon: 'terminal', order: 7, action: () => undefined },
  { id: 'shell.theme', title: 'Switch to light theme', icon: 'sun', order: 8, action: () => undefined },
  { id: 'shell.capacity', title: 'Show capacity panel', hint: '⌘B', icon: 'panelRight', order: 9, action: () => undefined },
];

const itemClass =
  'flex items-center gap-5 py-9px px-4 min-h-[40px] rounded-md border-0 bg-transparent text-text text-left cursor-pointer text-base select-none box-border data-[selected=true]:bg-active';

export function CommandPalette() {
  const paletteOpen = useWorkbenchStore((s) => s.paletteOpen);
  const closePalette = useWorkbenchStore((s) => s.closePalette);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(dialogRef, paletteOpen);

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
    <div className="fixed inset-[0px] z-10">
      <button
        type="button"
        onClick={closePalette}
        aria-label={shellStrings.palette.closeAriaLabel}
        className="absolute inset-[0px] w-full h-full border-0 bg-overlay cursor-default"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={shellStrings.palette.dialogAriaLabel}
        className="absolute top-[90px] left-1/2 -translate-x-1/2 w-[min(620px,calc(100%-32px))] border border-btnline rounded-xl bg-panel2 shadow-dialog overflow-hidden flex flex-col"
      >
        <Command label={shellStrings.palette.dialogAriaLabel}>
          <div className="flex items-center gap-4 py-5 px-6 border-b border-line">
            <Icon name="search" size={16} weight={1.9} className="text-muted2 flex-[0_0_16px]" />
            <Command.Input
              className="flex-auto border-0 bg-transparent text-text font-sans text-md outline-none placeholder:text-muted2"
              placeholder={shellStrings.palette.inputPlaceholder}
              aria-label={shellStrings.palette.inputAriaLabel}
            />
            <span className="py-1px px-2 border border-kbdline rounded-xs font-mono text-11px text-muted2">
              {shellStrings.palette.escHint}
            </span>
          </div>

          <Command.List className="p-2 max-h-[412px] box-border overflow-y-auto flex flex-col">
            <Command.Empty className="p-6 text-center text-muted2 text-sm">
              {shellStrings.palette.noResults}
            </Command.Empty>

            {commands.map((cmd) => (
              <Command.Item
                key={cmd.id}
                value={`${cmd.title} ${cmd.category ?? ''}`}
                onSelect={() => handleSelect(cmd.id)}
                className={itemClass}
                data-demo={demo ? 'true' : undefined}
              >
                {cmd.icon && (
                  <Icon
                    name={cmd.icon}
                    size={15}
                    weight={1.9}
                    className="text-muted flex-[0_0_15px]"
                  />
                )}
                <span className="flex-auto">{cmd.title}</span>
                {cmd.hint && <span className="text-faint text-11px font-mono">{cmd.hint}</span>}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
