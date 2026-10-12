import { beforeEach, describe, expect, it } from 'vitest';
import type { AccountsFile, AccountId, DoctorReport, OrchError, Result, SignInResult } from '@orchagents/contracts';
import type { CoreServices } from '../../src/browser/services/channelSchemas.js';
import {
  cancelAdd,
  finishSignIn,
  runMachineCheck,
  saveConfig,
  setUse,
  startSignIn,
} from '../../src/browser/contrib/accounts/actions.js';
import { useAccountsUiStore, EMPTY_ADD } from '../../src/browser/contrib/accounts/stores/accountsUi.js';
import { useConfigErrorsStore } from '../../src/browser/services/stores/config.js';
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
  openSignIn: unknown[];
  closed: unknown[];
  removed: unknown[];
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
      openSignIn: async (id: unknown) => {
        calls.openSignIn.push(id);
        return okResult('sh-1');
      },
      remove: async (id: unknown) => {
        calls.removed.push(id);
        return okResult(undefined);
      },
      checkSignIn: async (id: unknown) => {
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
    shells: {
      close: async (id: unknown) => {
        calls.closed.push(id);
        return okResult(undefined);
      },
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
  return { add: [], signIn: [], openSignIn: [], closed: [], removed: [], setConfig: [], doctor: [] };
}

describe('accounts actions', () => {
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

  it('Sign in creates the account with its type, starts the sign-in terminal, and checks when it ends', async () => {
    const calls = freshCalls();
    const services = fakeServices({}, calls);
    useAccountsUiStore.getState().resetAdd(true);
    useAccountsUiStore.getState().patchAdd({ agent: 'codex', name: ' Team ', type: ' Pro ' });
    await startSignIn(services);
    expect(calls.add).toEqual([{ agent: 'codex', name: 'Team', type: 'Pro' }]);
    expect(calls.openSignIn).toEqual(['codex-team']);
    expect(useAccountsUiStore.getState().add).toMatchObject({ phase: 'signing', shellId: 'sh-1', created: true });

    await finishSignIn(services, false);
    expect(calls.closed).toEqual([]);
    expect(useAccountsUiStore.getState().add).toMatchObject({ phase: 'result', shellId: null, signIn: { ready: true } });
  });

  it('Try again reuses the account instead of adding a second one', async () => {
    const calls = freshCalls();
    useAccountsUiStore.getState().resetAdd(true);
    useAccountsUiStore.getState().patchAdd({ agent: 'codex', name: 'Team', account: account('codex-team', 'codex', { name: 'Team' }), created: true });
    await startSignIn(fakeServices({}, calls));
    expect(calls.add).toEqual([]);
    expect(calls.openSignIn).toEqual(['codex-team']);
  });

  it('"I’m signed in" closes a terminal that stays open, then checks', async () => {
    const calls = freshCalls();
    useAccountsUiStore.getState().resetAdd(true);
    useAccountsUiStore.getState().patchAdd({ phase: 'signing', shellId: 'sh-1' as never, account: account('agy-main', 'agy') });
    await finishSignIn(fakeServices({}, calls), true);
    expect(calls.closed).toEqual(['sh-1']);
    expect(calls.signIn).toEqual(['agy-main']);
  });

  it('Cancel stops the sign-in and removes an account the dialog created; a Re-login account stays', async () => {
    const calls = freshCalls();
    const services = fakeServices({}, calls);
    useAccountsUiStore.getState().resetAdd(true);
    useAccountsUiStore.getState().patchAdd({ phase: 'signing', shellId: 'sh-1' as never, account: account('codex-team', 'codex'), created: true });
    await cancelAdd(services);
    expect(calls.closed).toEqual(['sh-1']);
    expect(calls.removed).toEqual(['codex-team']);
    expect(useAccountsUiStore.getState().add.open).toBe(false);

    useAccountsUiStore.getState().resetAdd(true);
    useAccountsUiStore.getState().patchAdd({ account: account('codex-work', 'codex'), created: false });
    await cancelAdd(services);
    expect(calls.removed).toEqual(['codex-team']);
  });

  it('keeps the form and shows the error when the account cannot be created', async () => {
    const error: OrchError = { code: 'conflict', message: 'That name is taken.', fix: 'Pick another name.' };
    const calls = freshCalls();
    const services = fakeServices({ accounts: { add: async () => errResult(error) } }, calls);
    useAccountsUiStore.getState().resetAdd(true);
    useAccountsUiStore.getState().patchAdd({ agent: 'codex', name: 'Team' });
    await startSignIn(services);
    expect(useAccountsUiStore.getState().add).toMatchObject({ phase: 'form', error });
    expect(calls.openSignIn).toEqual([]);
  });

  it('maps setConfig field errors into the editor and keeps the draft dirty', async () => {
    const calls = freshCalls();
    useAccountsUiStore.getState().setServerConfig('routing: primary-first', file);
    useAccountsUiStore.getState().setDraft('routing: nope');
    await saveConfig(fakeServices({}, calls), 'routing: nope');
    expect(calls.setConfig).toEqual(['routing: nope']);
    const ui = useAccountsUiStore.getState();
    expect(useConfigErrorsStore.getState().errors).toEqual([{ path: 'routing', line: 1, message: 'Unknown routing rule.' }]);
    expect(ui.configDirty).toBe(true);
    expect(ui.configDraft).toBe('routing: nope');
    expect(ui.notice?.message).toBe('Fix the file.');
  });

  it('clears the errors and marks the draft saved after a good save', async () => {
    const services = fakeServices({ accounts: { setConfig: async () => okResult(file) } }, freshCalls());
    useAccountsUiStore.getState().setServerConfig('routing: primary-first', file);
    useAccountsUiStore.getState().setDraft('routing: primary-first');
    useConfigErrorsStore.getState().setErrors([{ path: 'routing', line: 1, message: 'old' }]);
    await saveConfig(services, 'routing: primary-first');
    const ui = useAccountsUiStore.getState();
    expect(useConfigErrorsStore.getState().errors).toEqual([]);
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
