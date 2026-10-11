import { describe, expect, it, vi } from 'vitest';
import {
  ContributionRegistry,
  type ActivityItemContribution,
  type PaletteCommandContribution,
  type RouteContribution,
  type StatusItemContribution,
} from '../src/browser/services/registry.js';

describe('ContributionRegistry', () => {
  it('registers and retrieves routes, and disposes correctly', () => {
    const registry = new ContributionRegistry();
    const DummyComponent = () => null;

    const route: RouteContribution = {
      id: 'test.route',
      path: '/test',
      title: 'Test Route',
      component: DummyComponent,
    };

    const dispose = registry.registerRoute(route);
    expect(registry.getRoutes()).toHaveLength(1);
    expect(registry.getRoute('test.route')).toBe(route);

    dispose.dispose();
    expect(registry.getRoutes()).toHaveLength(0);
    expect(registry.getRoute('test.route')).toBeUndefined();
  });

  it('registers activity items and sorts them by order within groups', () => {
    const registry = new ContributionRegistry();

    const item1: ActivityItemContribution = {
      id: 'work',
      name: 'Work',
      label: 'Work area',
      icon: 'auto',
      order: 10,
      group: 'work',
    };

    const item2: ActivityItemContribution = {
      id: 'specs',
      name: 'Specs',
      label: 'Specs area',
      icon: 'file',
      order: 20,
      group: 'work',
    };

    const item3: ActivityItemContribution = {
      id: 'settings',
      name: 'Settings',
      label: 'Settings area',
      icon: 'gear',
      order: 70,
      group: 'bottom',
    };

    // Register out of order
    registry.registerActivityItem(item2);
    registry.registerActivityItem(item3);
    const dispose1 = registry.registerActivityItem(item1);

    const workItems = registry.getActivityItems('work');
    expect(workItems).toHaveLength(2);
    expect(workItems[0]?.id).toBe('work');
    expect(workItems[1]?.id).toBe('specs');

    const bottomItems = registry.getActivityItems('bottom');
    expect(bottomItems).toHaveLength(1);
    expect(bottomItems[0]?.id).toBe('settings');

    const allItems = registry.getActivityItems();
    expect(allItems).toHaveLength(3);
    expect(allItems.map((i) => i.id)).toEqual(['work', 'specs', 'settings']);

    dispose1.dispose();
    expect(registry.getActivityItems('work')).toHaveLength(1);
    expect(registry.getActivityItems('work')[0]?.id).toBe('specs');
  });

  it('registers commands and sorts them by order', () => {
    const registry = new ContributionRegistry();

    const cmd1: PaletteCommandContribution = {
      id: 'cmd.1',
      title: 'Command 1',
      order: 2,
      action: vi.fn(),
    };

    const cmd2: PaletteCommandContribution = {
      id: 'cmd.2',
      title: 'Command 2',
      order: 1,
      action: vi.fn(),
    };

    registry.registerCommand(cmd1);
    const dispose2 = registry.registerCommand(cmd2);

    const commands = registry.getCommands();
    expect(commands).toHaveLength(2);
    expect(commands[0]?.id).toBe('cmd.2');
    expect(commands[1]?.id).toBe('cmd.1');

    dispose2.dispose();
    expect(registry.getCommands()).toHaveLength(1);
    expect(registry.getCommands()[0]?.id).toBe('cmd.1');
  });

  it('registers status items and sorts them by priority descending', () => {
    const registry = new ContributionRegistry();

    const item1: StatusItemContribution = {
      id: 'status.low',
      alignment: 'left',
      priority: 10,
      render: () => null,
    };

    const item2: StatusItemContribution = {
      id: 'status.high',
      alignment: 'left',
      priority: 100,
      render: () => null,
    };

    const itemRight: StatusItemContribution = {
      id: 'status.right',
      alignment: 'right',
      priority: 50,
      render: () => null,
    };

    registry.registerStatusItem(item1);
    registry.registerStatusItem(item2);
    registry.registerStatusItem(itemRight);

    const leftItems = registry.getStatusItems('left');
    expect(leftItems).toHaveLength(2);
    expect(leftItems[0]?.id).toBe('status.high');
    expect(leftItems[1]?.id).toBe('status.low');

    const rightItems = registry.getStatusItems('right');
    expect(rightItems).toHaveLength(1);
    expect(rightItems[0]?.id).toBe('status.right');
  });

  it('fires onDidChange when registering and disposing contributions', () => {
    const registry = new ContributionRegistry();
    const listener = vi.fn();
    registry.onDidChange(listener);

    const dispose = registry.registerRoute({
      id: 'r1',
      path: '/r1',
      title: 'R1',
      component: () => null,
    });
    expect(listener).toHaveBeenCalledTimes(1);

    dispose.dispose();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
