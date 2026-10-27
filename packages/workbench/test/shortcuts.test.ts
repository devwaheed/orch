import { describe, expect, it, vi } from 'vitest';
import {
  AREA_FOR_DIGIT,
  AREA_SHORTCUTS,
  SHORTCUT_DEFINITIONS,
  ShortcutManager,
  formatShortcut,
  getAreaForDigit,
  matchesShortcut,
  type ShortcutId,
} from '../src/browser/services/shortcuts.js';

describe('Shortcuts (UI-05)', () => {
  const allShortcutIds: ShortcutId[] = [
    'commandPalette',
    'newJob',
    'newSpec',
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

  it('defines all locked shortcuts from UI-05', () => {
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

    it('matches ⌘N for new spec', () => {
      expect(matchesShortcut({ key: 'n', metaKey: true }, 'newSpec', isMac)).toBe(true);
      expect(matchesShortcut({ key: 'n', metaKey: true }, 'newJob', isMac)).toBe(true);
      expect(matchesShortcut({ key: 'n', ctrlKey: true }, 'newSpec', isMac)).toBe(false);
    });

    it('matches ⌘1 through ⌘5 for areas', () => {
      expect(matchesShortcut({ key: '1', metaKey: true }, 'specs', isMac)).toBe(true);
      expect(matchesShortcut({ key: '2', metaKey: true }, 'review', isMac)).toBe(true);
      expect(matchesShortcut({ key: '3', metaKey: true }, 'sessions', isMac)).toBe(true);
      expect(matchesShortcut({ key: '4', metaKey: true }, 'trust', isMac)).toBe(true);
      expect(matchesShortcut({ key: '5', metaKey: true }, 'accounts', isMac)).toBe(true);
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

    it('matches Ctrl+N for new spec', () => {
      expect(matchesShortcut({ key: 'n', ctrlKey: true }, 'newSpec', isMac)).toBe(true);
      expect(matchesShortcut({ key: 'n', ctrlKey: true }, 'newJob', isMac)).toBe(true);
    });

    it('matches Ctrl+1 through Ctrl+5 for areas', () => {
      expect(matchesShortcut({ key: '1', ctrlKey: true }, 'specs', isMac)).toBe(true);
      expect(matchesShortcut({ key: '2', ctrlKey: true }, 'review', isMac)).toBe(true);
      expect(matchesShortcut({ key: '3', ctrlKey: true }, 'sessions', isMac)).toBe(true);
      expect(matchesShortcut({ key: '4', ctrlKey: true }, 'trust', isMac)).toBe(true);
      expect(matchesShortcut({ key: '5', ctrlKey: true }, 'accounts', isMac)).toBe(true);
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
      expect(formatShortcut('newSpec', true)).toBe('⌘N');
      expect(formatShortcut('newJob', true)).toBe('⌘N');
      expect(formatShortcut('specs', true)).toBe('⌘1');
      expect(formatShortcut('review', true)).toBe('⌘2');
      expect(formatShortcut('sessions', true)).toBe('⌘3');
      expect(formatShortcut('trust', true)).toBe('⌘4');
      expect(formatShortcut('accounts', true)).toBe('⌘5');
      expect(formatShortcut('terminal', true)).toBe('⌃`');
      expect(formatShortcut('splitEditor', true)).toBe('⌘\\');
    });

    it('formats Windows/Linux shortcuts with Ctrl+', () => {
      expect(formatShortcut('commandPalette', false)).toBe('Ctrl+K');
      expect(formatShortcut('newSpec', false)).toBe('Ctrl+N');
      expect(formatShortcut('newJob', false)).toBe('Ctrl+N');
      expect(formatShortcut('specs', false)).toBe('Ctrl+1');
      expect(formatShortcut('review', false)).toBe('Ctrl+2');
      expect(formatShortcut('sessions', false)).toBe('Ctrl+3');
      expect(formatShortcut('trust', false)).toBe('Ctrl+4');
      expect(formatShortcut('accounts', false)).toBe('Ctrl+5');
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

    it('dispatches area shortcuts ⌘1 through ⌘5 in exact LOCKED UI-05 order', () => {
      const manager = new ShortcutManager(true);
      const calls: string[] = [];

      for (const area of AREA_SHORTCUTS) {
        manager.register(area, () => {
          calls.push(area);
        });
      }

      // ⌘1 Specs
      expect(manager.handleKeyDown({ key: '1', metaKey: true })).toBe(true);
      // ⌘2 Review
      expect(manager.handleKeyDown({ key: '2', metaKey: true })).toBe(true);
      // ⌘3 Sessions
      expect(manager.handleKeyDown({ key: '3', metaKey: true })).toBe(true);
      // ⌘4 Trust
      expect(manager.handleKeyDown({ key: '4', metaKey: true })).toBe(true);
      // ⌘5 Accounts
      expect(manager.handleKeyDown({ key: '5', metaKey: true })).toBe(true);

      expect(calls).toEqual(['specs', 'review', 'sessions', 'trust', 'accounts']);
    });
  });

  describe('Canonical Area Shortcuts (LOCKED UI-05, PRD-06)', () => {
    it('has exact 5 areas in sequence: Specs, Review, Sessions, Trust, Accounts', () => {
      expect(AREA_SHORTCUTS).toEqual([
        'specs',
        'review',
        'sessions',
        'trust',
        'accounts',
      ]);
    });

    it('maps digits 1..5 strictly to the 5 areas', () => {
      expect(AREA_FOR_DIGIT['1']).toBe('specs');
      expect(AREA_FOR_DIGIT['2']).toBe('review');
      expect(AREA_FOR_DIGIT['3']).toBe('sessions');
      expect(AREA_FOR_DIGIT['4']).toBe('trust');
      expect(AREA_FOR_DIGIT['5']).toBe('accounts');
    });

    it('getAreaForDigit resolves digit to area or undefined', () => {
      expect(getAreaForDigit('1')).toBe('specs');
      expect(getAreaForDigit('2')).toBe('review');
      expect(getAreaForDigit('3')).toBe('sessions');
      expect(getAreaForDigit('4')).toBe('trust');
      expect(getAreaForDigit('5')).toBe('accounts');
      expect(getAreaForDigit('0')).toBeUndefined();
      expect(getAreaForDigit('6')).toBeUndefined();
      expect(getAreaForDigit('7')).toBeUndefined();
    });
  });
});
