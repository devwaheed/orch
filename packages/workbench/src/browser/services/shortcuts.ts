/**
 * Shortcuts service (UI-05).
 * Shortcuts (⌘ on macOS, Ctrl elsewhere):
 * - ⌘K command palette
 * - ⌘N new job
 * - ⌘1 Work
 * - ⌘2 Specs
 * - ⌘3 Review
 * - ⌘4 Sessions
 * - ⌘5 Trust
 * - ⌘6 Accounts
 * - ⌘B capacity panel
 * - ⌃` terminal
 * - ⌘\ split editor
 * - ⌘W close tab
 */

export type ShortcutId =
  | 'commandPalette'
  | 'newJob'
  | 'work'
  | 'specs'
  | 'review'
  | 'sessions'
  | 'trust'
  | 'accounts'
  | 'capacity'
  | 'terminal'
  | 'splitEditor'
  | 'closeTab';

export interface KeyboardLikeEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface ShortcutDefinition {
  id: ShortcutId;
  key: string;
  /**
   * If true, uses metaKey on macOS and ctrlKey elsewhere.
   * If false, does not require the primary modifier.
   */
  primaryModifier: boolean;
  /**
   * If true, strictly requires ctrlKey regardless of OS (e.g. ⌃`).
   */
  ctrlModifier?: boolean;
  shiftModifier?: boolean;
  altModifier?: boolean;
  description: string;
}

export const SHORTCUT_DEFINITIONS: Record<ShortcutId, ShortcutDefinition> = {
  commandPalette: {
    id: 'commandPalette',
    key: 'k',
    primaryModifier: true,
    description: 'Command palette',
  },
  newJob: {
    id: 'newJob',
    key: 'n',
    primaryModifier: true,
    description: 'New job',
  },
  work: {
    id: 'work',
    key: '1',
    primaryModifier: true,
    description: 'Work',
  },
  specs: {
    id: 'specs',
    key: '2',
    primaryModifier: true,
    description: 'Specs',
  },
  review: {
    id: 'review',
    key: '3',
    primaryModifier: true,
    description: 'Review',
  },
  sessions: {
    id: 'sessions',
    key: '4',
    primaryModifier: true,
    description: 'Sessions',
  },
  trust: {
    id: 'trust',
    key: '5',
    primaryModifier: true,
    description: 'Trust',
  },
  accounts: {
    id: 'accounts',
    key: '6',
    primaryModifier: true,
    description: 'Accounts',
  },
  capacity: {
    id: 'capacity',
    key: 'b',
    primaryModifier: true,
    description: 'Capacity panel',
  },
  terminal: {
    id: 'terminal',
    key: '`',
    primaryModifier: false,
    ctrlModifier: true,
    description: 'Terminal dock',
  },
  splitEditor: {
    id: 'splitEditor',
    key: '\\',
    primaryModifier: true,
    description: 'Split editor',
  },
  closeTab: {
    id: 'closeTab',
    key: 'w',
    primaryModifier: true,
    description: 'Close tab',
  },
};

export function isPlatformMac(): boolean {
  if (typeof navigator !== 'undefined') {
    return navigator.userAgent.toLowerCase().includes('mac');
  }
  return true;
}

export function formatShortcut(id: ShortcutId, isMac: boolean = isPlatformMac()): string {
  const def = SHORTCUT_DEFINITIONS[id];
  const primaryMod = isMac ? '⌘' : 'Ctrl+';
  const ctrlMod = isMac ? '⌃' : 'Ctrl+';

  if (def.ctrlModifier) {
    return `${ctrlMod}${def.key}`;
  }
  if (def.primaryModifier) {
    const keyDisplay = def.key.toUpperCase();
    return `${primaryMod}${keyDisplay}`;
  }
  return def.key;
}

export function matchesShortcut(
  event: KeyboardLikeEvent,
  id: ShortcutId,
  isMac: boolean = isPlatformMac()
): boolean {
  const def = SHORTCUT_DEFINITIONS[id];
  const eventKey = event.key.toLowerCase();
  const defKey = def.key.toLowerCase();

  if (eventKey !== defKey) {
    return false;
  }

  const meta = Boolean(event.metaKey);
  const ctrl = Boolean(event.ctrlKey);
  const alt = Boolean(event.altKey);
  const shift = Boolean(event.shiftKey);

  if (alt !== Boolean(def.altModifier)) {
    return false;
  }
  if (shift !== Boolean(def.shiftModifier)) {
    return false;
  }

  if (def.ctrlModifier) {
    return ctrl && !meta;
  }

  if (def.primaryModifier) {
    if (isMac) {
      return meta && !ctrl;
    }
    return ctrl && !meta;
  }

  return !meta && !ctrl;
}

export type ShortcutHandler = () => void | Promise<void>;

export class ShortcutManager {
  private handlers = new Map<ShortcutId, Set<ShortcutHandler>>();
  private isMac: boolean;

  constructor(isMac: boolean = isPlatformMac()) {
    this.isMac = isMac;
  }

  register(id: ShortcutId, handler: ShortcutHandler): () => void {
    let set = this.handlers.get(id);
    if (!set) {
      set = new Set();
      this.handlers.set(id, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(id);
      }
    };
  }

  handleKeyDown(event: KeyboardLikeEvent): boolean {
    for (const [id, handlers] of this.handlers.entries()) {
      if (matchesShortcut(event, id, this.isMac)) {
        for (const handler of handlers) {
          handler();
        }
        return true;
      }
    }
    return false;
  }

  attach(target: Window | HTMLElement): () => void {
    const listener = (event: KeyboardEvent) => {
      const handled = this.handleKeyDown(event);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    target.addEventListener('keydown', listener as EventListener);
    return () => {
      target.removeEventListener('keydown', listener as EventListener);
    };
  }
}
