import { describe, expect, it } from 'vitest';
import { shellStrings } from '../src/browser/parts/strings.js';

describe('Shell Strings (UI-07)', () => {
  it('defines exact title bar strings matching screens.md', () => {
    expect(shellStrings.appName).toBe('orch');
    expect(shellStrings.titleBar.searchPlaceholder).toBe(
      'Search runs, sessions, or run a command',
    );
    expect(shellStrings.titleBar.newJob).toBe('New job');
    expect(shellStrings.titleBar.notifications(0)).toBe('Notifications');
    expect(shellStrings.titleBar.notifications(3)).toBe('Notifications, 3 new');
  });

  it('defines activity bar names and labels matching PRD-06 and screens.md', () => {
    expect(shellStrings.activityBar.work.name).toBe('Work');
    expect(shellStrings.activityBar.work.label).toBe('Work: run and steer agents');

    expect(shellStrings.activityBar.specs.name).toBe('Specs');
    expect(shellStrings.activityBar.specs.label).toBe(
      'Specs: ordered queue that runs itself',
    );

    expect(shellStrings.activityBar.review.name).toBe('Review');
    expect(shellStrings.activityBar.review.label).toBe('Review: approve changes');

    expect(shellStrings.activityBar.sessions.name).toBe('Sessions');
    expect(shellStrings.activityBar.sessions.label).toBe('Sessions: resume and recover');

    expect(shellStrings.activityBar.trust.name).toBe('Trust');
    expect(shellStrings.activityBar.trust.label).toBe(
      'Trust: how reliable agent work is',
    );

    expect(shellStrings.activityBar.accounts.name).toBe('Accounts');
    expect(shellStrings.activityBar.accounts.label).toBe('Accounts: logins and routing');

    expect(shellStrings.activityBar.settings.name).toBe('Settings');
  });

  it('defines status bar copy matching screens.md', () => {
    expect(shellStrings.statusBar.engineName).toBe('orchd');
    expect(shellStrings.statusBar.branch).toBe('main');
    expect(shellStrings.statusBar.terminal).toBe('Terminal');
    expect(shellStrings.statusBar.paletteCommandsHint).toBe('⌘K commands');

    expect(
      shellStrings.statusBar.limitedStatus('Claude', 'Account 1', '14:32'),
    ).toBe('Claude · Account 1 limited → 14:32');

    expect(shellStrings.statusBar.signedOutStatus(1)).toBe('1 account signed out');
    expect(shellStrings.statusBar.signedOutStatus(2)).toBe('2 accounts signed out');
  });

  it('defines capacity and palette copy matching screens.md', () => {
    expect(shellStrings.capacity.title).toBe('Capacity');
    expect(shellStrings.capacity.emptyTitle).toBe('No account usage data yet');
    expect(shellStrings.capacity.emptyDescription).toBe(
      'Live usage per account appears here once jobs run.',
    );

    expect(shellStrings.palette.inputPlaceholder).toBe('Type a command or search…');
    expect(shellStrings.palette.noResults).toBe('No commands found.');
  });
});
