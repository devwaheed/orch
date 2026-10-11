/**
 * Zustand store for workbench shell state.
 * Orca/VS Code practice: selective, lightweight subscriptions.
 */
import { create } from 'zustand';

export type AreaId =
  | 'work'
  | 'specs'
  | 'review'
  | 'sessions'
  | 'trust'
  | 'accounts'
  | 'settings';

export interface LimitedAccountInfo {
  text: string;
  accountId: string;
}

export interface WorkbenchState {
  activeArea: AreaId;
  activeRoute: string;
  capacityOpen: boolean;
  paletteOpen: boolean;
  splitOpen: boolean;
  terminalOpen: boolean;
  activeProject: string;
  statusRuns: string;
  engineHealthy: boolean;
  currentBranch: string;
  limitedAccount: LimitedAccountInfo | null;
  signedOutCount: number;
  badges: Record<string, string | number | undefined>;

  setActiveArea: (area: AreaId) => void;
  setActiveRoute: (route: string) => void;
  toggleCapacity: () => void;
  setCapacityOpen: (open: boolean) => void;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  toggleSplit: () => void;
  toggleTerminal: () => void;
  setActiveProject: (project: string) => void;
  setStatusRuns: (runs: string) => void;
  setBadge: (area: string, count: string | number | undefined) => void;
  setLimitedAccount: (info: LimitedAccountInfo | null) => void;
  setEngineHealthy: (healthy: boolean) => void;
  setSignedOutCount: (count: number) => void;
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  activeArea: 'work',
  activeRoute: '/work',
  capacityOpen: false,
  paletteOpen: false,
  splitOpen: false,
  terminalOpen: false,
  // Live values arrive from services (later stories) or ORCH_DEMO sample data (S2-02); never ship samples as defaults.
  activeProject: '',
  statusRuns: '',
  engineHealthy: false,
  currentBranch: '',
  limitedAccount: null,
  signedOutCount: 0,
  badges: {},

  setActiveArea: (activeArea) => {
    const routeMap: Record<AreaId, string> = {
      work: '/work',
      specs: '/specs',
      review: '/review',
      sessions: '/sessions',
      trust: '/trust',
      accounts: '/accounts',
      settings: '/settings',
    };
    set({ activeArea, activeRoute: routeMap[activeArea] ?? '/work' });
  },

  setActiveRoute: (activeRoute) => {
    let area: AreaId = 'work';
    if (activeRoute.startsWith('/specs')) area = 'specs';
    else if (activeRoute.startsWith('/review')) area = 'review';
    else if (activeRoute.startsWith('/sessions')) area = 'sessions';
    else if (activeRoute.startsWith('/trust')) area = 'trust';
    else if (activeRoute.startsWith('/accounts')) area = 'accounts';
    else if (activeRoute.startsWith('/settings')) area = 'settings';
    set({ activeRoute, activeArea: area });
  },

  toggleCapacity: () => set((s) => ({ capacityOpen: !s.capacityOpen })),
  setCapacityOpen: (capacityOpen) => set({ capacityOpen }),
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  toggleSplit: () => set((s) => ({ splitOpen: !s.splitOpen })),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  setActiveProject: (activeProject) => set({ activeProject }),
  setStatusRuns: (statusRuns) => set({ statusRuns }),
  setBadge: (area, count) =>
    set((s) => ({
      badges: { ...s.badges, [area]: count },
    })),
  setLimitedAccount: (limitedAccount) => set({ limitedAccount }),
  setEngineHealthy: (engineHealthy) => set({ engineHealthy }),
  setSignedOutCount: (signedOutCount) => set({ signedOutCount }),
}));
