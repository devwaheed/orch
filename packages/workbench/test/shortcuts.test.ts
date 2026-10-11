import { describe, expect, it, vi } from 'vitest';
import {
  SHORTCUT_DEFINITIONS,
  ShortcutManager,
  formatShortcut,
  matchesShortcut,
  type ShortcutId,
} from '../src/browser/services/shortcuts.js';

describe('Shortcuts (UI-05)', () => {
  const allShortcutIds: ShortcutId[] = [
    'commandPalette',
    'newJob',
    'work',
    'specs',
    'review',
    'sessions',
    'trust',
    'accounts',
    'capacity',
    'terminal',
    'splitEditor',
    'closeTab',
  ];

  it('defines all 12 locked shortcuts from UI-05', () => {
    for (const id of allShortcutIds) {
      expect(SHORTCUT_DEFINITIONS[id]).toBeDefined();
      expect(SHORTCUT_DEFINITIONS[id].id).toBe(id);
    }
  });

  describe('matchesShortcut on macOS', () => {
    const isMac = true;

    it('matches ⌘K for command palette', () => {
      expect(matchesShortcut({ key: 'k', metaKey: true }, 'commandPalette', isMac)).toBe(true);
      expect(matchesShortcut({ key: 'K', metaKey: true }, 'commandPalette', isMac)).toBe(true);
      expect(matchesShortcut({ key: 'k', ctrlKey: true }, 'commandPalette', isMac)).toBe(false);
      expect(matchesShortcut({ key: 'j', metaKey: true }, 'commandPalette', isMac)).toBe(false);
    });

    it('matches ⌘N for new job', () => {
      expect(matchesShortcut({ key: 'n', metaKey: true }, 'newJob', isMac)).toBe(true);
      expect(matchesShortcut({ key: 'n', ctrlKey: true }, 'newJob', isMac)).toBe(false);
    });

    it('matches ⌘1 through ⌘6 for areas', () => {
      expect(matchesShortcut({ key: '1', metaKey: true }, 'work', isMac)).toBe(true);
      expect(matchesShortcut({ key: '2', metaKey: true }, 'specs', isMac)).toBe(true);
      expect(matchesShortcut({ key: '3', metaKey: true }, 'review', isMac)).toBe(true);
      expect(matchesShortcut({ key: '4', metaKey: true }, 'sessions', isMac)).toBe(true);
      expect(matchesShortcut({ key: '5', metaKey: true }, 'trust', isMac)).toBe(true);
      expect(matchesShortcut({ key: '6', metaKey: true }, 'accounts', isMac)).toBe(true);
    });

    it('matches ⌘B for capacity panel', () => {
      expect(matchesShortcut({ key: 'b', metaKey: true }, 'capacity', isMac)).toBe(true);
    });

    it('matches ⌃` for terminal on macOS', () => {
      expect(matchesShortcut({ key: '`', ctrlKey: true, metaKey: false }, 'terminal', isMac)).toBe(true);
      expect(matchesShortcut({ key: '`', metaKey: true }, 'terminal', isMac)).toBe(false);
    });

    it('matches ⌘\\ for split editor', () => {
      expect(matchesShortcut({ key: '\\', metaKey: true }, 'splitEditor', isMac)).toBe(true);
    });

    it('matches ⌘W for close tab', () => {
      expect(matchesShortcut({ key: 'w', metaKey: true }, 'closeTab', isMac)).toBe(true);
    });
  });

  describe('matchesShortcut on Windows / Linux', () => {
    const isMac = false;

    it('matches Ctrl+K for command palette', () => {
      expect(matchesShortcut({ key: 'k', ctrlKey: true }, 'commandPalette', isMac)).toBe(true);
      expect(matchesShortcut({ key: 'k', metaKey: true }, 'commandPalette', isMac)).toBe(false);
    });

    it('matches Ctrl+N for new job', () => {
      expect(matchesShortcut({ key: 'n', ctrlKey: true }, 'newJob', isMac)).toBe(true);
    });

    it('matches Ctrl+1 through Ctrl+6 for areas', () => {
      expect(matchesShortcut({ key: '1', ctrlKey: true }, 'work', isMac)).toBe(true);
      expect(matchesShortcut({ key: '2', ctrlKey: true }, 'specs', isMac)).toBe(true);
      expect(matchesShortcut({ key: '3', ctrlKey: true }, 'review', isMac)).toBe(true);
      expect(matchesShortcut({ key: '4', ctrlKey: true }, 'sessions', isMac)).toBe(true);
      expect(matchesShortcut({ key: '5', ctrlKey: true }, 'trust', isMac)).toBe(true);
      expect(matchesShortcut({ key: '6', ctrlKey: true }, 'accounts', isMac)).toBe(true);
    });

    it('matches Ctrl+B for capacity panel', () => {
      expect(matchesShortcut({ key: 'b', ctrlKey: true }, 'capacity', isMac)).toBe(true);
    });

    it('matches ⌃` (Ctrl+`) for terminal on Windows/Linux', () => {
      expect(matchesShortcut({ key: '`', ctrlKey: true }, 'terminal', isMac)).toBe(true);
    });

    it('matches Ctrl+\\ for split editor', () => {
      expect(matchesShortcut({ key: '\\', ctrlKey: true }, 'splitEditor', isMac)).toBe(true);
    });

    it('matches Ctrl+W for close tab', () => {
      expect(matchesShortcut({ key: 'w', ctrlKey: true }, 'closeTab', isMac)).toBe(true);
    });
  });

  describe('formatShortcut', () => {
    it('formats macOS shortcuts with ⌘', () => {
      expect(formatShortcut('commandPalette', true)).toBe('⌘K');
      expect(formatShortcut('newJob', true)).toBe('⌘N');
      expect(formatShortcut('work', true)).toBe('⌘1');
      expect(formatShortcut('terminal', true)).toBe('⌃`');
      expect(formatShortcut('splitEditor', true)).toBe('⌘\\');
    });

    it('formats Windows/Linux shortcuts with Ctrl+', () => {
      expect(formatShortcut('commandPalette', false)).toBe('Ctrl+K');
      expect(formatShortcut('newJob', false)).toBe('Ctrl+N');
      expect(formatShortcut('work', false)).toBe('Ctrl+1');
      expect(formatShortcut('terminal', false)).toBe('Ctrl+`');
      expect(formatShortcut('splitEditor', false)).toBe('Ctrl+\\');
    });
  });

  describe('ShortcutManager', () => {
    it('executes registered handler when shortcut matches', () => {
      const manager = new ShortcutManager(true);
      const fn = vi.fn();
      const dispose = manager.register('commandPalette', fn);

      const handled = manager.handleKeyDown({ key: 'k', metaKey: true });
      expect(handled).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);

      dispose();
      const handledAfter = manager.handleKeyDown({ key: 'k', metaKey: true });
      expect(handledAfter).toBe(false);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns false when no shortcut matches', () => {
      const manager = new ShortcutManager(true);
      const handled = manager.handleKeyDown({ key: 'z' });
      expect(handled).toBe(false);
    });
  });
});
