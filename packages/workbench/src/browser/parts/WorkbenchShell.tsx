import React, { useEffect, useMemo } from 'react';
import { TitleBar } from './titlebar/TitleBar.js';
import { EngineFailureBar } from './enginebar/EngineFailureBar.js';
import { ActivityBar } from './activitybar/ActivityBar.js';
import { StatusBar } from './statusbar/StatusBar.js';
import { CapacityPanel } from './capacity/CapacityPanel.js';
import { CommandPalette } from './palette/CommandPalette.js';
import { useWorkbenchStore } from '../services/workbenchStore.js';
import { AREA_SHORTCUTS, ShortcutManager } from '../services/shortcuts.js';
import { workbenchRegistry } from '../services/registry.js';
import { useThemeStore } from '../services/theme.js';
import styles from './WorkbenchShell.module.css';

export function WorkbenchShell() {
  const activeArea = useWorkbenchStore((s) => s.activeArea);
  const activeRoute = useWorkbenchStore((s) => s.activeRoute);
  const setActiveArea = useWorkbenchStore((s) => s.setActiveArea);
  const setActiveRoute = useWorkbenchStore((s) => s.setActiveRoute);
  const togglePalette = useWorkbenchStore((s) => s.togglePalette);
  const toggleCapacity = useWorkbenchStore((s) => s.toggleCapacity);
  const toggleTerminal = useWorkbenchStore((s) => s.toggleTerminal);
  const toggleSplit = useWorkbenchStore((s) => s.toggleSplit);

  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  const shortcutManager = useMemo(() => new ShortcutManager(), []);

  useEffect(() => {
    const unsubs = [
      shortcutManager.register('commandPalette', () => togglePalette()),
      shortcutManager.register('newJob', () => setActiveRoute('/jobs/new')),
      ...AREA_SHORTCUTS.map((area) =>
        shortcutManager.register(area, () => setActiveArea(area)),
      ),
      shortcutManager.register('capacity', () => toggleCapacity()),
      shortcutManager.register('terminal', () => toggleTerminal()),
      shortcutManager.register('splitEditor', () => toggleSplit()),
      shortcutManager.register('closeTab', () => {
        // Handled per tab if open; default no-op
      }),
    ];

    const detach = shortcutManager.attach(window);

    return () => {
      detach();
      unsubs.forEach((u) => u());
    };
  }, [
    shortcutManager,
    setActiveArea,
    setActiveRoute,
    togglePalette,
    toggleCapacity,
    toggleTerminal,
    toggleSplit,
  ]);

  const routes = workbenchRegistry.getRoutes();
  const matchedRoute = routes.find((r) => r.path === activeRoute);
  const RouteComponent = matchedRoute?.component;

  return (
    <div data-theme={resolvedTheme} className={styles.workbenchShell}>
      <TitleBar />
      <EngineFailureBar />

      <div className={styles.bodyRow}>
        <ActivityBar />

        <div className={styles.contentColumn}>
          <main className={styles.mainContent}>
            {RouteComponent ? (
              React.createElement(RouteComponent)
            ) : (
              <div className={styles.emptyView}>
                <span className={styles.emptyViewTitle}>
                  {activeArea.charAt(0).toUpperCase() + activeArea.slice(1)}
                </span>
                <span className={styles.emptyViewText}>
                  Route: {activeRoute}
                </span>
              </div>
            )}
          </main>
        </div>

        <CapacityPanel />
      </div>

      <StatusBar />
      <CommandPalette />
      {workbenchRegistry.getOverlays().map(({ id, component: Overlay }) => (
        <Overlay key={id} />
      ))}
    </div>
  );
}
