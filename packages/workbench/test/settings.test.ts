import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountsFile, DoctorReport, RoutingRule } from '@orchagents/contracts';
import { useWorkbenchStore } from '../src/browser/services/workbenchStore.js';
import { useThemeStore } from '../src/browser/services/theme.js';
import { useMenuSideStore } from '../src/browser/services/menuSide.js';
import { useSettingsUiStore } from '../src/browser/contrib/settings/stores/settingsUi.js';
import { bindSettingsServices } from '../src/browser/contrib/settings/services.js';
import {
  getAccountsFilePath,
  getLogsDirPath,
  installCli,
  refreshConfig,
  restartEngine,
  runChecks,
  setRouting,
  showItemInFolder,
} from '../src/browser/contrib/settings/actions.js';
import type { CoreServices } from '../src/browser/services/channelSchemas.js';

function createSampleAccountsFile(routing: RoutingRule = 'primary-first'): AccountsFile {
  return {
    routing,
    accounts: {},
    limits: {
      max_runs_per_account: 5,
      near_limit_at: '90%',
    },
    share_skills: true,
  };
}

function createSampleDoctorReport(cliOnPath: boolean = true): DoctorReport {
  return {
    os: 'macos',
    orchVersion: '1.2.3',
    engineVersion: '7.5.6',
    checks: [
      {
        id: 'cli_on_path',
        title: cliOnPath ? 'The orch command is on PATH' : 'The orch command is not on your PATH',
        status: cliOnPath ? 'pass' : 'warn',
        fix: cliOnPath ? undefined : 'Add orch to your PATH',
      },
      {
        id: 'engine',
        title: 'Engine is responding',
        status: 'pass',
      },
    ],
  };
}

function createMockServices(overrides: Partial<CoreServices> = {}): CoreServices {
  let file = createSampleAccountsFile();
  const report = createSampleDoctorReport();

  return {
    accounts: {
      getConfig: vi.fn().mockImplementation(async () => ({
        ok: true,
        value: { text: '', parsed: file },
      })),
      setRouting: vi.fn().mockImplementation(async (rule: RoutingRule) => {
        file = { ...file, routing: rule };
        return { ok: true, value: undefined };
      }),
      listAgents: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      list: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      add: vi.fn(),
      signIn: vi.fn(),
      openSignIn: vi.fn(),
      checkSignIn: vi.fn(),
      setPrimary: vi.fn(),
      setUse: vi.fn(),
      setShareSkills: vi.fn(),
      remove: vi.fn(),
      setConfig: vi.fn(),
    },
    doctor: {
      run: vi.fn().mockResolvedValue({ ok: true, value: report }),
    },
    jobs: {} as unknown as CoreServices['jobs'],
    quota: {} as unknown as CoreServices['quota'],
    review: {} as unknown as CoreServices['review'],
    runs: {} as unknown as CoreServices['runs'],
    sessions: {} as unknown as CoreServices['sessions'],
    shells: {} as unknown as CoreServices['shells'],
    trust: {} as unknown as CoreServices['trust'],
    specs: {} as unknown as CoreServices['specs'],
    bugreport: {} as unknown as CoreServices['bugreport'],
    ...overrides,
  };
}

describe('Settings Area', () => {
  beforeEach(() => {
    const env = globalThis as unknown as {
      window: unknown;
      document: unknown;
    };
    env.window = globalThis;
    env.document = {
      documentElement: {
        setAttribute: vi.fn(),
        getAttribute: vi.fn(),
      },
      getElementById: vi.fn(),
    };
    useSettingsUiStore.setState({
      file: createSampleAccountsFile(),
      doctorReport: createSampleDoctorReport(),
      runningChecks: false,
      installingCli: false,
      activeSection: 'general',
    });
    useWorkbenchStore.setState({
      activeArea: 'settings',
      activeRoute: '/settings',
      engineHealthy: true,
    });
    window.orch = {
      connect: vi.fn(),
      app: {
        version: '1.2.3',
        os: 'macos',
        demo: false,
        home: '/Users/test',
        openExternal: vi.fn(),
        showItemInFolder: vi.fn(),
        openPath: vi.fn(),
        chooseFolder: vi.fn(),
        onUpdateReady: vi.fn(() => () => undefined),
        onOpenProject: vi.fn(() => () => undefined),
        cliCommand: {
          offered: true,
          install: vi.fn().mockResolvedValue(undefined),
          uninstall: vi.fn(),
          machineCheckFinished: vi.fn(),
        },
        onReportProblem: vi.fn(() => () => undefined),
        onOpenHelp: vi.fn(() => () => undefined),
        openNewIssue: vi.fn(),
        restartEngine: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  it('manages theme choices in useThemeStore', () => {
    useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().choice).toBe('light');
    useThemeStore.getState().setTheme('dark');
    expect(useThemeStore.getState().choice).toBe('dark');
    useThemeStore.getState().setTheme('system');
    expect(useThemeStore.getState().choice).toBe('system');
  });

  it('manages menu side correctly in useMenuSideStore', () => {
    useMenuSideStore.getState().setSide('right');
    expect(useMenuSideStore.getState().side).toBe('right');
    useMenuSideStore.getState().setSide('left');
    expect(useMenuSideStore.getState().side).toBe('left');
    useMenuSideStore.getState().toggleSide();
    expect(useMenuSideStore.getState().side).toBe('right');
  });

  it('resolves accounts.yaml and logs paths correctly', () => {
    expect(getAccountsFilePath()).toBe('/Users/test/.orch/accounts.yaml');
    expect(getLogsDirPath()).toBe('/Users/test/.orch/logs');
  });

  it('executes settings actions correctly', async () => {
    const services = createMockServices();
    bindSettingsServices(services);

    // Refresh config
    await refreshConfig(services);
    expect(services.accounts.getConfig).toHaveBeenCalled();
    expect(useSettingsUiStore.getState().file?.limits.max_runs_per_account).toBe(5);

    // Set routing
    await setRouting(services, 'most-headroom');
    expect(services.accounts.setRouting).toHaveBeenCalledWith('most-headroom');
    expect(useSettingsUiStore.getState().file?.routing).toBe('most-headroom');

    // Run checks
    await runChecks(services);
    expect(services.doctor.run).toHaveBeenCalled();
    expect(useSettingsUiStore.getState().doctorReport?.engineVersion).toBe('7.5.6');

    // Install CLI
    await installCli(services);
    expect(window.orch?.app.cliCommand.install).toHaveBeenCalled();

    // Restart engine
    await restartEngine();
    expect(window.orch?.app.restartEngine).toHaveBeenCalled();

    // Show item in folder
    await showItemInFolder('/test/path');
    expect(window.orch?.app.showItemInFolder).toHaveBeenCalledWith('/test/path');
  });
});
