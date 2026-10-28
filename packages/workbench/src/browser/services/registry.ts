/**
 * Contribution registry for orch workbench.
 * Registers:
 * - routes
 * - activity bar items (order strictly PRD-06)
 * - palette commands (for cmdk command palette)
 * - status bar items
 * - overlays (dialogs an area renders above the shell)
 */
import { Emitter, type Event, type IDisposable, toDisposable } from '@orchagents/base';
import type { IconName } from '../../../../../design/icons/icons.js';
import type React from 'react';

export interface RouteContribution {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly component: React.ComponentType;
  readonly default?: boolean;
  readonly openNotificationSpec?: (specId: string) => void;
}

export type ActivityItemGroup = 'work' | 'config' | 'bottom';

export interface ActivityItemContribution {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly icon: IconName;
  readonly order: number;
  readonly group: ActivityItemGroup;
  readonly badge?: string | number | (() => string | number | undefined);
  readonly badgeType?: 'info' | 'ok' | 'warn' | 'err';
  readonly routeId?: string;
  readonly action?: () => void;
}

export interface PaletteCommandContribution {
  readonly id: string;
  readonly title: string;
  readonly hint?: string;
  readonly icon?: IconName;
  readonly category?: string;
  readonly order?: number;
  readonly action: () => void | Promise<void>;
}

export interface StatusItemContribution {
  readonly id: string;
  readonly alignment: 'left' | 'right';
  readonly priority: number;
  readonly render: () => React.ReactNode;
}

/** A component the shell renders above every screen, e.g. an area's dialog that can open from anywhere. */
export interface OverlayContribution {
  readonly id: string;
  readonly component: React.ComponentType;
}

export class ContributionRegistry implements IDisposable {
  private routes = new Map<string, RouteContribution>();
  private activityItems = new Map<string, ActivityItemContribution>();
  private commands = new Map<string, PaletteCommandContribution>();
  private statusItems = new Map<string, StatusItemContribution>();
  private overlays = new Map<string, OverlayContribution>();

  private readonly onDidChangeEmitter = new Emitter<void>();
  readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

  registerRoute(route: RouteContribution): IDisposable {
    this.routes.set(route.id, route);
    this.onDidChangeEmitter.fire();
    return toDisposable(() => {
      this.routes.delete(route.id);
      this.onDidChangeEmitter.fire();
    });
  }

  getRoutes(): readonly RouteContribution[] {
    return Array.from(this.routes.values());
  }

  getRoute(id: string): RouteContribution | undefined {
    return this.routes.get(id);
  }

  registerActivityItem(item: ActivityItemContribution): IDisposable {
    this.activityItems.set(item.id, item);
    this.onDidChangeEmitter.fire();
    return toDisposable(() => {
      this.activityItems.delete(item.id);
      this.onDidChangeEmitter.fire();
    });
  }

  getActivityItems(group?: ActivityItemGroup): readonly ActivityItemContribution[] {
    const all = Array.from(this.activityItems.values());
    const filtered = group ? all.filter((i) => i.group === group) : all;
    return filtered.sort((a, b) => a.order - b.order);
  }

  registerCommand(command: PaletteCommandContribution): IDisposable {
    this.commands.set(command.id, command);
    this.onDidChangeEmitter.fire();
    return toDisposable(() => {
      this.commands.delete(command.id);
      this.onDidChangeEmitter.fire();
    });
  }

  getCommands(): readonly PaletteCommandContribution[] {
    return Array.from(this.commands.values()).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }

  registerStatusItem(item: StatusItemContribution): IDisposable {
    this.statusItems.set(item.id, item);
    this.onDidChangeEmitter.fire();
    return toDisposable(() => {
      this.statusItems.delete(item.id);
      this.onDidChangeEmitter.fire();
    });
  }

  getStatusItems(alignment: 'left' | 'right'): readonly StatusItemContribution[] {
    return Array.from(this.statusItems.values())
      .filter((i) => i.alignment === alignment)
      .sort((a, b) => b.priority - a.priority);
  }

  registerOverlay(overlay: OverlayContribution): IDisposable {
    this.overlays.set(overlay.id, overlay);
    this.onDidChangeEmitter.fire();
    return toDisposable(() => {
      this.overlays.delete(overlay.id);
      this.onDidChangeEmitter.fire();
    });
  }

  getOverlays(): readonly OverlayContribution[] {
    return Array.from(this.overlays.values());
  }

  /** Runs a registered palette command by id, so shell parts can reach an area without importing it. */
  runCommand(id: string): void {
    void this.commands.get(id)?.action();
  }

  dispose(): void {
    this.routes.clear();
    this.activityItems.clear();
    this.commands.clear();
    this.statusItems.clear();
    this.overlays.clear();
    this.onDidChangeEmitter.dispose();
  }
}

export const workbenchRegistry = new ContributionRegistry();
