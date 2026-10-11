import { beforeEach, describe, expect, it } from 'vitest';
import type { AccountsFile } from '@orch/contracts';
import { useAccountsUiStore, EMPTY_ADD } from '../../src/browser/contrib/accounts/stores/accountsUi.js';
import { useConfigErrorsStore } from '../../src/browser/services/stores/config.js';

const file: AccountsFile = {
  routing: 'primary-first',
  accounts: {},
  limits: { max_runs_per_account: 3, near_limit_at: '85%' },
  share_skills: true,
};

describe('accounts UI store', () => {
  beforeEach(() => {
    useConfigErrorsStore.setState({ errors: [] });
    useAccountsUiStore.setState({
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
    });
  });

  it('follows the core text while the user has not edited the file', () => {
    const store = useAccountsUiStore.getState();
    store.setServerConfig('routing: primary-first', file);
    store.setServerConfig('routing: most-headroom', file);
    expect(useAccountsUiStore.getState().configDraft).toBe('routing: most-headroom');
    expect(useAccountsUiStore.getState().configDirty).toBe(false);
  });

  it('keeps an unsaved edit when the core text changes under it', () => {
    const store = useAccountsUiStore.getState();
    store.setServerConfig('routing: primary-first', file);
    store.setDraft('routing: typo');
    store.setServerConfig('routing: most-headroom', file);
    const after = useAccountsUiStore.getState();
    expect(after.configDraft).toBe('routing: typo');
    expect(after.configText).toBe('routing: most-headroom');
    expect(after.configDirty).toBe(true);
  });

  it('clears the draft and dirty flag after a save', () => {
    const store = useAccountsUiStore.getState();
    store.setServerConfig('routing: primary-first', file);
    store.setDraft('routing: most-headroom');
    store.markSaved('routing: most-headroom', file);
    const after = useAccountsUiStore.getState();
    expect(after.configDirty).toBe(false);
    expect(after.configDraft).toBe('routing: most-headroom');
  });

  it('opens the add dialog at step 1 with Work as the default name', () => {
    useAccountsUiStore.getState().resetAdd(true);
    const add = useAccountsUiStore.getState().add;
    expect(add).toMatchObject({ open: true, step: 1, agent: null, name: 'Work', account: null, signIn: null });
  });

  it('keeps the machine report while only the running flag changes', () => {
    const store = useAccountsUiStore.getState();
    store.setMachine({ report: { os: 'linux', orchVersion: '1', engineVersion: '1', checks: [] } });
    store.setMachine({ running: true });
    expect(useAccountsUiStore.getState().machineReport?.os).toBe('linux');
    expect(useAccountsUiStore.getState().machineRunning).toBe(true);
  });
});
