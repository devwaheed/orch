import React, { useEffect, useMemo, useRef } from 'react';
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
import { TerminalDock } from './terminal/TerminalDock.js';

/** The route-not-found view; reused for the core-unavailable state (workbench.main.ts). */
export const EMPTY_VIEW_CLASSES =
  'flex flex-auto flex-col items-center justify-center gap-3 p-8 text-muted text-center';
export const EMPTY_VIEW_TITLE_CLASSES = 'text-lg font-semibold text-text2';
export const EMPTY_VIEW_TEXT_CLASSES = 'text-sm text-muted2';

export function WorkbenchShell() {
  const activeArea = useWorkbenchStore((s) => s.activeArea);
  const activeRoute = useWorkbenchStore((s) => s.activeRoute);
  const setActiveArea = useWorkbenchStore((s) => s.setActiveArea);
  const setActiveRoute = useWorkbenchStore((s) => s.setActiveRoute);
  const togglePalette = useWorkbenchStore((s) => s.togglePalette);
  const toggleCapacity = useWorkbenchStore((s) => s.toggleCapacity);
  const toggleTerminal = useWorkbenchStore((s) => s.toggleTerminal);
  const toggleSplit = useWorkbenchStore((s) => s.toggleSplit);
  const terminalDockOwned = useWorkbenchStore((s) => s.terminalDockOwned);

  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const dockInRoute = activeRoute === '/specs' && terminalDockOwned;

  const shortcutManager = useMemo(() => new ShortcutManager(), []);

  useEffect(() => {
    const unsubs = [
      shortcutManager.register('commandPalette', () => togglePalette()),
      shortcutManager.register('help', () => workbenchRegistry.runCommand('help.open')),
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

  const mainRef = useRef<HTMLElement>(null);
  const helpReturnRef = useRef<{ route: string; scrollTop: number } | null>(null);
  const prevRouteRef = useRef(activeRoute);

  useEffect(() => {
    if (mainRef.current) {
      if (
        prevRouteRef.current === '/help' &&
        helpReturnRef.current &&
        helpReturnRef.current.route === activeRoute
      ) {
        mainRef.current.scrollTop = helpReturnRef.current.scrollTop;
        helpReturnRef.current = null;
      } else {
        if (activeRoute === '/help') {
          helpReturnRef.current = {
            route: prevRouteRef.current,
            scrollTop: mainRef.current.scrollTop,
          };
        } else {
          helpReturnRef.current = null;
        }
        mainRef.current.scrollTop = 0;
      }
    }
    prevRouteRef.current = activeRoute;
  }, [activeRoute]);

  return (
    <div
      data-theme={resolvedTheme}
      className="relative flex h-screen flex-col bg-bg font-sans text-base leading-normal text-text overflow-hidden"
    >
      <TitleBar />
      <EngineFailureBar />

      <div className="flex flex-auto items-stretch min-h-[0px] in-data-[menu-side=right]:flex-row-reverse">
        <ActivityBar />

        <div className="flex flex-1 min-w-[0px] flex-col min-h-[0px]">
          <main ref={mainRef} className="flex flex-1 min-w-[0px] flex-col bg-bg overflow-auto">
            {RouteComponent ? (
              React.createElement(RouteComponent)
            ) : (
              <div className={EMPTY_VIEW_CLASSES}>
                <span className={EMPTY_VIEW_TITLE_CLASSES}>
                  {activeArea.charAt(0).toUpperCase() + activeArea.slice(1)}
                </span>
                <span className={EMPTY_VIEW_TEXT_CLASSES}>
                  Route: {activeRoute}
                </span>
              </div>
            )}
          </main>
          {!dockInRoute && <TerminalDock />}
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
