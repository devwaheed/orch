/**
 * Area-local UI state for the Accounts screen: the view toggle, the config file text
 * and draft, the machine check, and the add-account dialog. Account and agent data stay
 * in the shared stores (services/stores/accounts.ts and quota.ts).
 */
import { create } from 'zustand';
import type { Account, AccountsFile, AgentId, DoctorReport, Os, OrchError, ShellId, SignInResult } from '@orchagents/contracts';

export type AccountsView = 'visual' | 'config';

/** form: pick and name · signing: the agent's sign-in runs in the dialog's terminal · result: the three checks. */
export type AddPhase = 'form' | 'signing' | 'checking' | 'result';

export interface AddDialogState {
  readonly open: boolean;
  readonly phase: AddPhase;
  readonly agent: AgentId | null;
  readonly agentFixed: boolean;
  readonly name: string;
  /** Free text the user marks the account with (accounts.yaml `type`). */
  readonly type: string;
  /** The account being signed in: created by this dialog, or an existing one (Re-login). */
  readonly account: Account | null;
  /** True when this dialog created `account`, so Cancel removes it again. */
  readonly created: boolean;
  /** The terminal running the agent's sign-in. */
  readonly shellId: ShellId | null;
  readonly signIn: SignInResult | null;
  readonly busy: boolean;
  readonly error: OrchError | null;
}

export const EMPTY_ADD: AddDialogState = {
  open: false,
  phase: 'form',
  agent: null,
  agentFixed: false,
  name: '',
  type: '',
  account: null,
  created: false,
  shellId: null,
  signIn: null,
  busy: false,
  error: null,
};

export interface AccountsUiState {
  readonly view: AccountsView;
  readonly os: Os | null;
  readonly file: AccountsFile | null;
  /** The text the core holds (getConfig). */
  readonly configText: string;
  /** What the editor shows. Follows configText unless the user has unsaved edits. */
  readonly configDraft: string;
  readonly configDirty: boolean;
  readonly machineReport: DoctorReport | null;
  readonly machineRunning: boolean;
  /** Last failed action, shown in the screen. */
  readonly notice: OrchError | null;
  readonly add: AddDialogState;
  readonly removing: Account | null;

  setView(view: AccountsView): void;
  setOs(os: Os): void;
  setServerConfig(text: string, file: AccountsFile): void;
  setDraft(text: string): void;
  markSaved(text: string, file: AccountsFile): void;
  setMachine(patch: { report?: DoctorReport | null; running?: boolean }): void;
  setNotice(error: OrchError | null): void;
  patchAdd(patch: Partial<AddDialogState>): void;
  resetAdd(open: boolean): void;
  setRemoving(account: Account | null): void;
}

export const useAccountsUiStore = create<AccountsUiState>()((set) => ({
  view: 'visual',
  os: null,
  file: null,
  configText: '',
  configDraft: '',
  configDirty: false,
  machineReport: null,
  machineRunning: false,
  notice: null,
  add: EMPTY_ADD,
  removing: null,

  setView: (view) => set({ view }),
  setOs: (os) => set({ os }),
  setServerConfig: (text, file) =>
    set((s) => ({
      file,
      configText: text,
      configDraft: s.configDirty ? s.configDraft : text,
    })),
  setDraft: (text) => set({ configDraft: text, configDirty: true }),
  markSaved: (text, file) =>
    set({ file, configText: text, configDraft: text, configDirty: false }),
  setMachine: (patch) =>
    set((s) => ({
      machineReport: patch.report === undefined ? s.machineReport : patch.report,
      machineRunning: patch.running ?? s.machineRunning,
    })),
  setNotice: (error) => set({ notice: error }),
  patchAdd: (patch) => set((s) => ({ add: { ...s.add, ...patch } })),
  resetAdd: (open) => set({ add: { ...EMPTY_ADD, open } }),
  setRemoving: (account) => set({ removing: account }),
}));
