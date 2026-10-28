import { create } from 'zustand';
import type { AccountsFile, DoctorReport } from '@orchagents/contracts';

export interface SettingsUiState {
  readonly file: AccountsFile | null;
  readonly doctorReport: DoctorReport | null;
  readonly runningChecks: boolean;
  readonly installingCli: boolean;
  readonly activeSection: string;
  readonly setFile: (file: AccountsFile | null) => void;
  readonly setDoctorReport: (report: DoctorReport | null) => void;
  readonly setRunningChecks: (running: boolean) => void;
  readonly setInstallingCli: (installing: boolean) => void;
  readonly setActiveSection: (section: string) => void;
}

export const useSettingsUiStore = create<SettingsUiState>((set) => ({
  file: null,
  doctorReport: null,
  runningChecks: false,
  installingCli: false,
  activeSection: 'general',
  setFile: (file) => set({ file }),
  setDoctorReport: (doctorReport) => set({ doctorReport }),
  setRunningChecks: (runningChecks) => set({ runningChecks }),
  setInstallingCli: (installingCli) => set({ installingCli }),
  setActiveSection: (activeSection) => set({ activeSection }),
}));
