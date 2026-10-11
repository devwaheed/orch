import { beforeEach, describe, expect, it } from 'vitest';
import type { AccountsFile, AccountId, DoctorReport, OrchError, Result, SignInResult } from '@orch/contracts';
import type { CoreServices } from '../../src/browser/services/channelSchemas.js';
import {
  addProfile,
  runMachineCheck,
  saveConfig,
  setUse,
  signIn,
} from '../../src/browser/contrib/accounts/actions.js';
import { useAccountsUiStore, EMPTY_ADD } from '../../src/browser/contrib/accounts/stores/accountsUi.js';
import { account } from './fixtures.js';

const file: AccountsFile = {
  routing: 'primary-first',
  accounts: {},
  limits: { max_runs_per_account: 3, near_limit_at: '85%' },
  share_skills: true,
};

const okResult = <T>(value: T): Result<T> => ({ ok: true, value });
const errResult = (error: OrchError): Result<never> => ({ ok: false, error });

interface Calls {
  add: unknown[];
  signIn: unknown[];
  setConfig: unknown[];
  doctor: unknown[];
}

function fakeServices(overrides: Partial<Record<string, unknown>>, calls: Calls): CoreServices {
  const base = {
    accounts: {
      listAgents: async () => okResult([]),
      list: async () => okResult([]),
      add: async (req: unknown) => {
        calls.add.push(req);
        return okResult(account('codex-team', 'codex', { name: 'Team', state: 'signed_out' }));
      },
      signIn: async (id: unknown) => {
        calls.signIn.push(id);
        const result: SignInResult = {
          accountId: 'codex-team' as AccountId,
          signedIn: true,
          keptSeparate: true,
          ready: true,
          identity: 'unknown',
        };
        return okResult(result);
      },
      setUse: async () => okResult(undefined),
      getConfig: async () => okResult({ text: 'routing: primary-first', parsed: file }),
      setConfig: async (text: unknown) => {
        calls.setConfig.push(text);
        return errResult({ code: 'validation_failed', message: 'Fix the file.', details: { errors: [{ path: 'routing', line: 1, message: 'Unknown routing rule.' }] } });
      },
      ...((overrides.accounts as object) ?? {}),
    },
    doctor: {
      run: async (req: unknown) => {
        calls.doctor.push(req);
        const report: DoctorReport = {
          os: 'linux',
          orchVersion: '0.0.0',
          engineVersion: '7.5.6',
          checks: [{ id: 'logins', title: 'Logins', status: 'pass' }],
        };
        return okResult(report);
      },
    },
  };
  return base as unknown as CoreServices;
}

function freshCalls(): Calls {
  return { add: [], signIn: [], setConfig: [], doctor: [] };
}

describe('accounts actions', () => {
  beforeEach(() => {
    useAccountsUiStore.setState({
      view: 'visual',
      os: null,
      file: null,
      configText: '',
      configDraft: '',
      configDirty: false,
      configErrors: [],
      machineReport: null,
      machineRunning: false,
      notice: null,
      add: EMPTY_ADD,
    });
  });

  it('creates the profile when moving from Name to Sign in, then goes to step 3', async () => {
    const calls = freshCalls();
    useAccountsUiStore.getState().resetAdd(true);
    useAccountsUiStore.getState().patchAdd({ step: 2, agent: 'codex', name: 'Team' });
    await addProfile(fakeServices({}, calls));
    expect(calls.add).toEqual([{ agent: 'codex', name: 'Team' }]);
    const add = useAccountsUiStore.getState().add;
    expect(add.step).toBe(3);
    expect(add.account?.name).toBe('Team');
  });

  it('does not create a second profile when going back and forward with the same name', async () => {
    const calls = freshCalls();
    useAccountsUiStore.getState().resetAdd(true);
    useAccountsUiStore.getState().patchAdd({ step: 2, agent: 'codex', name: 'Team', account: account('codex-team', 'codex', { name: 'Team' }) });
    await addProfile(fakeServices({}, calls));
    expect(calls.add).toEqual([]);
    expect(useAccountsUiStore.getState().add.step).toBe(3);
  });

  it('runs sign-in on the created account and stores the three-check result', async () => {
    const calls = freshCalls();
    useAccountsUiStore.getState().resetAdd(true);
    useAccountsUiStore.getState().patchAdd({ step: 3, account: account('codex-team', 'codex') });
    await signIn(fakeServices({}, calls), 'codex-team' as AccountId);
    expect(calls.signIn).toEqual(['codex-team']);
    const add = useAccountsUiStore.getState().add;
    expect(add.signIn?.identity).toBe('unknown');
    expect(add.busy).toBe(false);
  });

  it('keeps the dialog on step 2 and shows the error when the profile cannot be created', async () => {
    const error: OrchError = { code: 'conflict', message: 'That name is taken.', fix: 'Pick another name.' };
    const services = fakeServices({ accounts: { add: async () => errResult(error) } }, freshCalls());
    useAccountsUiStore.getState().resetAdd(true);
    useAccountsUiStore.getState().patchAdd({ step: 2, agent: 'codex', name: 'Team' });
    await addProfile(services);
    const add = useAccountsUiStore.getState().add;
    expect(add.step).toBe(2);
    expect(add.error).toEqual(error);
  });

  it('maps setConfig field errors into the editor and keeps the draft dirty', async () => {
    const calls = freshCalls();
    useAccountsUiStore.getState().setServerConfig('routing: primary-first', file);
    useAccountsUiStore.getState().setDraft('routing: nope');
    await saveConfig(fakeServices({}, calls), 'routing: nope');
    expect(calls.setConfig).toEqual(['routing: nope']);
    const ui = useAccountsUiStore.getState();
    expect(ui.configErrors).toEqual([{ path: 'routing', line: 1, message: 'Unknown routing rule.' }]);
    expect(ui.configDirty).toBe(true);
    expect(ui.configDraft).toBe('routing: nope');
    expect(ui.notice?.message).toBe('Fix the file.');
  });

  it('clears the errors and marks the draft saved after a good save', async () => {
    const services = fakeServices({ accounts: { setConfig: async () => okResult(file) } }, freshCalls());
    useAccountsUiStore.getState().setServerConfig('routing: primary-first', file);
    useAccountsUiStore.getState().setDraft('routing: primary-first');
    useAccountsUiStore.getState().setConfigErrors([{ path: 'routing', line: 1, message: 'old' }]);
    await saveConfig(services, 'routing: primary-first');
    const ui = useAccountsUiStore.getState();
    expect(ui.configErrors).toEqual([]);
    expect(ui.configDirty).toBe(false);
  });

  it('shows a failed visual change as a notice instead of throwing', async () => {
    const error: OrchError = { code: 'account_signed_out', message: 'Sign in first.' };
    const services = fakeServices({ accounts: { setUse: async () => errResult(error) } }, freshCalls());
    await setUse(services, 'claude-work' as AccountId, false);
    expect(useAccountsUiStore.getState().notice).toEqual(error);
  });

  it('runs the machine check with two throwaway profiles and keeps the OS', async () => {
    const calls = freshCalls();
    await runMachineCheck(fakeServices({}, calls));
    expect(calls.doctor).toEqual([{ signInTwice: true }]);
    expect(useAccountsUiStore.getState().machineReport?.os).toBe('linux');
    expect(useAccountsUiStore.getState().machineRunning).toBe(false);
  });
});
