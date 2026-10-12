/**
 * The core host: every orch service, registered in one ServiceCollection with
 * explicit dependencies, served over the local socket (SEC-01), and OrchEvents
 * forwarded to subscribers.
 *
 * Shared by both entries: the headless Node child process (coreHost.ts) and the
 * Electron utility process (electron-utility/coreHost.ts). Nothing here imports
 * Electron or Claw. The home folder is an option: the entries pass os.homedir(),
 * tests pass a temp folder, so the real ~/.orch is never touched in tests.
 */
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, unlink, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { Emitter, ServiceCollection, createServiceId, err, ok, type Event, type IDisposable } from '@orchagents/base';
import type {
  AgentAdapter,
  ChannelName,
  IDoctorService,
  IBugReportService,
  IEventsService,
  OrchError,
  OrchEvent,
  Os,
} from '@orchagents/contracts';
import { ChannelServer, MessagePortTransport, type MessagePortLike } from '@orchagents/platform/channels/common';
import type { EnginePort } from '@orchagents/platform/src/engine/common/engineClient.js';
import { SocketServer } from '@orchagents/platform/channels/node';
import { AntigravityAdapter } from '@orchagents/platform/src/adapters/node/agy.js';
import { ClaudeAdapter } from '@orchagents/platform/src/adapters/node/claude.js';
import { CodexAdapter } from '@orchagents/platform/src/adapters/node/codex.js';
import { GeminiAdapter } from '@orchagents/platform/src/adapters/node/gemini.js';
import { OpenCodeAdapter } from '@orchagents/platform/src/adapters/node/opencode.js';
import { createProcessRunners } from '@orchagents/platform/src/adapters/node/processRunner.js';
import { ACCOUNT_COPY } from '@orchagents/platform/src/accounts/common/copy.js';
import type { IAccountProcessRunner } from '@orchagents/platform/src/accounts/common/accounts.js';
import { AccountsService } from '@orchagents/platform/src/accounts/node/accountsService.js';
import { ConfigService } from '@orchagents/platform/src/config/node/configService.js';
import type { IConfigService } from '@orchagents/platform/src/config/common/config.js';
import { ProfilesService, currentOs, defaultProfilesRoot } from '@orchagents/platform/src/profiles/node/profilesService.js';
import { filterEngineEnv } from '@orchagents/platform/src/profiles/common/profiles.js';
import { DoctorService } from '@orchagents/platform/src/doctor/node/doctorService.js';
import type { ProcessRunner } from '@orchagents/platform/src/doctor/common/doctor.js';
import { GitService } from '@orchagents/platform/src/git/node/gitService.js';
import { JobsService } from '@orchagents/platform/src/jobs/node/jobsService.js';
import { RunsService } from '@orchagents/platform/src/runs/node/runsService.js';
import { GitSessionWorktrees } from '@orchagents/platform/src/sessions/node/forkWorktree.js';
import { SessionsService } from '@orchagents/platform/src/sessions/node/sessionsService.js';
import { StoreSessionRepository } from '@orchagents/platform/src/sessions/node/storeSessionRepository.js';
import { QuotaService } from '@orchagents/platform/src/quota/node/quotaService.js';
import { StoreQuotaStore } from '@orchagents/platform/src/quota/node/storeQuotaStore.js';
import { SpecsQueueService } from '@orchagents/platform/src/specs/queue/node/specsQueueService.js';
import { StoreService } from '@orchagents/platform/src/store/node/storeService.js';
import { ReviewService } from '@orchagents/platform/src/review/node/reviewService.js';
import { TrustService } from '@orchagents/platform/src/trust/node/trustService.js';
import { StoreTrustLevelStore } from '@orchagents/platform/src/trust/node/trustLevelStore.js';
import { AdapterTrustAgents, MemoryTrustGardener, StoreTrustCorrections, StoreTrustRunHistory } from './trustPorts.js';
import { CHANNEL_SCHEMAS } from './channelSchemas.js';
import { BugReportService, cleanOldBugReports } from '@orchagents/platform/src/bugreport/node/index.js';
import { createDemoServices, serveDemoServices } from './demo/index.js';
import { EngineChild, type EngineChildOptions } from './engineChild.js';
import { PtyHostChild, type PtyHostChildOptions } from './ptyChild.js';
import { ShellsServiceWrapper } from './shellsWrapper.js';
import { ConfigQuotaSettings, StoreQuotaAccounts } from './quotaPorts.js';

/** Minimum free disk space for the doctor's disk check: 2 GB in bytes. owner decision 2026-10-11 */
export const DOCTOR_MIN_FREE_BYTES = 2 * 1024 ** 3;

/** accounts.yaml watch debounce in ms (lead-chosen internal value). */
export const CONFIG_WATCH_DEBOUNCE_MS = 100;

/**
 * How often quota ends limits whose reset time has passed (quota.sweep), in ms.
 * Lead-chosen internal value; quota.available for a timed limit is at most this late.
 */
export const QUOTA_SWEEP_INTERVAL_MS = 60_000;

/** The version the doctor reports. Matches packages/app/package.json. */
export const ORCH_VERSION = '0.0.0';

export interface CoreHostOptions {
  /** The user's home folder. ~/.orch lives inside it. Entries pass os.homedir(). */
  readonly home: string;
  /** The environment commands start with. Entries copy process.env; platform code never reads it. */
  readonly baseEnv: Readonly<Record<string, string>>;
  /** Defaults to the OS this process runs on. */
  readonly os?: Os;
  /** Used in the Windows pipe name. Defaults to the logged-in user's name. */
  readonly username?: string;
  /** Overrides for tests, e.g. a fake doctor runner that never starts a real command. */
  readonly runners?: { readonly doctor?: ProcessRunner; readonly accounts?: IAccountProcessRunner };
  /** The engine host, forked as a child process. Omit to run without an engine: its checks then report it unavailable. */
  readonly engine?: Omit<EngineChildOptions, 'env'>;
  /**
   * An engine host that already runs (the Electron engine utility) and is reached
   * through this port. Takes precedence over `engine`: no engine child is forked.
   */
  readonly enginePort?: EnginePort;
  /**
   * Set when an engine port will be attached after start (attachEnginePort), as
   * Electron does. Runs past-due auto-resumes wait for that engine too.
   */
  readonly awaitEnginePort?: boolean;
  /** The PTY host. Omit to run without a PTY host. */
  readonly pty?: Omit<PtyHostChildOptions, 'env'>;
  /** Agent adapters. Defaults to the five real adapters. */
  readonly adapters?: readonly AgentAdapter[];
  /** Overrides the doctor's free-space measurement. */
  readonly measureFreeBytes?: (dir: string) => Promise<number | null>;
  /** When true (or when ORCH_DEMO=1), serves fake demo services with prototype sample data. */
  readonly demo?: boolean;
}

export interface RunningCoreHost {
  /** The socket path (macOS/Linux) or the named pipe (Windows). */
  readonly socketPath: string;
  readonly tokenPath: string;
  /** Set when the database was damaged and restored from a backup. Show it to the user. */
  readonly recovery: OrchError | null;
  /** Serves one window or host connection over a MessagePort (the Electron utility uses this). */
  attachPort(port: MessagePortLike): void;
  /** Uses the engine host that the port reaches instead of forking one (Electron hands it over at start-up). */
  attachEnginePort(port: EnginePort): void;
  /** Stops the socket, the engine and the store, and removes the token file. */
  dispose(): Promise<void>;
}

/** Everything under ~/.orch (ENG-03, SEC-01, SEC-04, ACC-01). */
export interface OrchPaths {
  readonly root: string;
  readonly db: string;
  readonly backups: string;
  readonly accounts: string;
  readonly profiles: string;
  readonly engine: string;
  readonly bugReports: string;
  readonly socket: string;
  readonly token: string;
}

/** SEC-01: the socket path, or the named pipe on Windows. */
export function orchPaths(home: string, os: Os, username: string): OrchPaths {
  const root = join(home, '.orch');
  return {
    root,
    db: join(root, 'orch.db'),
    backups: join(root, 'backups'),
    accounts: join(root, 'accounts.yaml'),
    profiles: defaultProfilesRoot(home),
    engine: join(root, 'engine'),
    bugReports: join(root, 'bug-reports'),
    socket: os === 'windows' ? `\\\\.\\pipe\\orch-${username}` : join(root, 'orch.sock'),
    token: join(root, 'token'),
  };
}

/** Forwards OrchEvents to every subscriber. Implements the events channel. */
export class EventsHub implements IEventsService {
  private readonly emitter = new Emitter<OrchEvent>();
  /** The engine is usually ready before a window connects; a late subscriber still learns its health. */
  private lastEngineHealth: OrchEvent | null = null;

  subscribe(listener: (event: OrchEvent) => void): () => void {
    const subscription = this.emitter.event(listener);
    const health = this.lastEngineHealth;
    if (health) queueMicrotask(() => listener(health));
    return () => subscription.dispose();
  }

  fire(event: OrchEvent): void {
    if (event.type === 'engine.health') this.lastEngineHealth = event;
    this.emitter.fire(event);
  }

  /** Forwards every event from a service's own Event stream. */
  attach(source: Event<OrchEvent>): IDisposable {
    return source((event) => this.fire(event));
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

export const ICoreStore = createServiceId<StoreService>('store');
export const ICoreConfig = createServiceId<ConfigService>('config');
export const ICoreProfiles = createServiceId<ProfilesService>('profiles');
export const ICoreAccounts = createServiceId<AccountsService>('accounts');
export const ICoreQuota = createServiceId<QuotaService>('quota');
export const ICoreEngine = createServiceId<EngineChild>('engine');
export const ICoreDoctor = createServiceId<IDoctorService>('doctor');
export const ICoreEvents = createServiceId<EventsHub>('events');
export const ICoreGit = createServiceId<GitService>('git');
export const ICoreRuns = createServiceId<RunsService>('runs');
export const ICoreJobs = createServiceId<JobsService>('jobs');
export const ICoreReview = createServiceId<ReviewService>('review');
export const ICorePty = createServiceId<PtyHostChild>('pty');
export const ICoreShells = createServiceId<ShellsServiceWrapper>('shells');
export const ICoreSessions = createServiceId<SessionsService>('sessions');
export const ICoreTrust = createServiceId<TrustService>('trust');
export const ICoreSpecs = createServiceId<SpecsQueueService>('specs');
export const ICoreBugReport = createServiceId<IBugReportService>('bugreport');

/** Builds the service collection. Each service's dependencies are listed at its registration. */
function registerServices(options: {
  readonly paths: OrchPaths;
  readonly home: string;
  readonly os: Os;
  readonly adapters: readonly AgentAdapter[];
  readonly runners: { readonly doctor: ProcessRunner; readonly accounts: IAccountProcessRunner };
  readonly engine: EngineChildOptions | null;
  readonly pty: PtyHostChildOptions | null;
  readonly minFreeBytes: number;
  readonly measureFreeBytes?: (dir: string) => Promise<number | null>;
}): ServiceCollection {
  const { paths, home, os, adapters, runners } = options;
  const services = new ServiceCollection();

  const adapterFor = (agent: string): AgentAdapter | undefined => adapters.find((adapter) => adapter.id === agent);

  // Store: ~/.orch/orch.db with backups (SEC-04). Opened in startCoreHost.
  services.register(ICoreStore, StoreService, []);

  // Config: ~/.orch/accounts.yaml, watched for outside edits.
  services.register(
    ICoreConfig,
    class extends ConfigService {
      constructor() {
        super({ filePath: paths.accounts, watchDebounceMs: CONFIG_WATCH_DEBOUNCE_MS });
      }
    },
    [],
  );

  // Profiles: ~/.orch/profiles (ACC-01).
  services.register(
    ICoreProfiles,
    class extends ProfilesService {
      constructor() {
        super({ profilesRoot: paths.profiles, homeDir: home, os, adapterFor });
      }
    },
    [],
  );

  // Accounts: store, config and profiles, plus the process runner.
  services.register(
    ICoreAccounts,
    class extends AccountsService {
      constructor(store: StoreService, config: ConfigService, profiles: ProfilesService) {
        super({ store, config, profiles, adapters, runner: runners.accounts, os, homeDir: home });
      }
    },
    [ICoreStore, ICoreConfig, ICoreProfiles],
  );

  // Quota: its ports are the store, the accounts table and accounts.yaml, plus
  // the engine client for spendToday (ledger.query).
  services.register(
    ICoreQuota,
    class extends QuotaService {
      constructor(store: StoreService, config: IConfigService, engine: EngineChild) {
        super({
          store: new StoreQuotaStore(store),
          accounts: new StoreQuotaAccounts(store),
          settings: new ConfigQuotaSettings(config),
          engine,
          now: () => new Date(),
        });
      }
    },
    [ICoreStore, ICoreConfig, ICoreEngine],
  );

  // Events: the one place every OrchEvent is published.
  services.register(ICoreEvents, EventsHub, []);

  // Git: worktrees per writing run (JOB-02). Runs its own commands through execa.
  services.register(ICoreGit, GitService, []);

  // Sessions: resume, hand-off and fork (SES-01..SES-04). Records live in the store;
  // accounts, quota and profiles give the options and envs; the engine resumes or starts
  // sessions; git makes forks.
  services.register(
    ICoreSessions,
    class extends SessionsService {
      constructor(store: StoreService, accounts: AccountsService, quota: QuotaService, profiles: ProfilesService, engine: EngineChild) {
        super({
          repo: new StoreSessionRepository(store),
          accounts,
          quota,
          profiles,
          engine,
          worktrees: new GitSessionWorktrees(),
          now: () => new Date(),
        });
      }
    },
    [ICoreStore, ICoreAccounts, ICoreQuota, ICoreProfiles, ICoreEngine],
  );

  // Runs: one row per agent run, its lines and its session (JOB-03, JOB-08).
  services.register(
    ICoreRuns,
    class extends RunsService {
      constructor(store: StoreService, profiles: ProfilesService, engine: EngineChild, sessions: SessionsService) {
        super({ store, profiles, engine, sessions });
      }
    },
    [ICoreStore, ICoreProfiles, ICoreEngine, ICoreSessions],
  );

  // Jobs: single-mode jobs. The agent adapter comes from the adapter list; an agent
  // missing from that list is a registration bug, so the lookup fails loudly.
  services.register(
    ICoreJobs,
    class extends JobsService {
      constructor(
        store: StoreService,
        quota: QuotaService,
        profiles: ProfilesService,
        engine: EngineChild,
        git: GitService,
        runs: RunsService,
        sessions: SessionsService,
      ) {
        super({
          store,
          quota,
          profiles,
          engine,
          git,
          runs,
          sessions,
          adapterFor: (agent) => {
            const adapter = adapterFor(agent);
            if (!adapter) throw new Error(`No agent adapter is registered for ${agent}.`);
            return adapter;
          },
        });
      }
    },
    [ICoreStore, ICoreQuota, ICoreProfiles, ICoreEngine, ICoreGit, ICoreRuns, ICoreSessions],
  );

  // Trust: track records, the ladder and the gardener switch (TRU-01..TRU-04). Its run history
  // and corrections come from the store; the gardener is in memory until S4-05 lands.
  services.register(
    ICoreTrust,
    class extends TrustService {
      constructor(store: StoreService) {
        super({
          agents: new AdapterTrustAgents(adapters),
          runs: new StoreTrustRunHistory(store),
          corrections: new StoreTrustCorrections(store),
          levels: new StoreTrustLevelStore(store),
          gardener: new MemoryTrustGardener(
            () => new Date(),
            () => Intl.DateTimeFormat().resolvedOptions().timeZone,
          ),
        });
      }
    },
    [ICoreStore],
);

  // Specs: the spec queue (spec-queue.md). Git makes the worktrees; quota picks the account for each try.
  services.register(
    ICoreSpecs,
    class extends SpecsQueueService {
      constructor(git: GitService, quota: QuotaService) {
        super({ git, quota });
      }
    },
    [ICoreGit, ICoreQuota],
  );

  // Review: verdicts, merge gate, corrections (REV-01..05, TRU-03).
  services.register(
    ICoreReview,
    class extends ReviewService {
      constructor(
        store: StoreService,
        git: GitService,
        runs: RunsService,
        jobs: JobsService,
        engine: EngineChild,
      ) {
        super({ store, git, runs, jobs, engine });
      }
    },
    [ICoreStore, ICoreGit, ICoreRuns, ICoreJobs, ICoreEngine],
  );

  // Engine: the engine host child process (ENG-07). Its health events go to the events hub.
  services.register(
    ICoreEngine,
    class extends EngineChild {
      constructor(events: EventsHub) {
        super(options.engine, (event) => events.fire(event));
      }
    },
    [ICoreEvents],
  );

  // Doctor: profiles and the engine, plus the process runner for the commands it checks.
  services.register(
    ICoreDoctor,
    class extends DoctorService {
      constructor(profiles: ProfilesService, engine: EngineChild) {
        super({
          agents: adapters,
          runner: runners.doctor,
          profiles,
          engine,
          signIn: async (agent, profileDir) => {
            const adapter = adapterFor(agent);
            if (!adapter) return err({ code: 'internal', ...ACCOUNT_COPY.agentUnavailable });
            const spec = adapter.loginCommand(profileDir, os);
            const login = await runners.accounts.run(
              { ...spec, env: filterEngineEnv(spec.env) },
              { interactive: true },
            );
            if (login?.exitCode === 0) return ok(undefined);
            return err({ code: 'internal', ...ACCOUNT_COPY.agentCannotStart(adapter.displayName, adapter.command) });
          },
          os,
          homeDir: home,
          dataDir: paths.root,
          orchVersion: ORCH_VERSION,
          minFreeBytes: options.minFreeBytes,
          ...(options.measureFreeBytes ? { measureFreeBytes: options.measureFreeBytes } : {}),
        });
      }
    },
    [ICoreProfiles, ICoreEngine],
  );

// PTY host: supervised child process for real shells (ADR 0006).
  class PtyHostRegistered extends PtyHostChild {
    constructor() {
      super(options.pty, () => {
        ShellsServiceRegisteredLocal.instance?.onPtyHostRestart();
      });
    }
  }
  services.register(ICorePty, PtyHostRegistered, []);

  // Shells: talks to the PTY host over a MessagePort.
  class ShellsServiceRegisteredLocal extends ShellsServiceWrapper {
    static instance: ShellsServiceWrapper | null = null;
    constructor(pty: PtyHostChild) {
      super(pty);
      ShellsServiceRegisteredLocal.instance = this;
    }
  }
  services.register(ICoreShells, ShellsServiceRegisteredLocal, [ICorePty]);

  // Bug report service (BUG-01, BUG-02, BUG-03)
  services.register(
    ICoreBugReport,
    class extends BugReportService {
      constructor(doctorService: IDoctorService) {
        super({
          home: options.home,
          runDoctor: () => doctorService.run(),
        });
      }
    },
    [ICoreDoctor],
  );

  return services;
}

/** Registers one channel service. The name must be a contract channel (CHANNELS). */
function serve(
  channel: ChannelServer,
  name: ChannelName,
  service: object,
  schemas?: Parameters<ChannelServer['registerService']>[2],
): void {
  channel.registerService(name, service, schemas);
}

export async function startCoreHost(options: CoreHostOptions): Promise<RunningCoreHost> {
  const os: Os = options.os ?? currentOs();
  const username = options.username ?? userInfo().username;
  const paths = orchPaths(options.home, os, username);
  await mkdir(paths.root, { recursive: true, mode: 0o700 });

  const isDemo = options.demo ?? (process.env.ORCH_DEMO === '1' || options.baseEnv.ORCH_DEMO === '1');
  if (isDemo) {
    const events = new EventsHub();
    const demo = createDemoServices(events, os);
    const channel = new ChannelServer(events);
    serveDemoServices(channel, demo);

    const token = randomBytes(32).toString('hex');
    await writeFile(paths.token, token, { mode: 0o600 });
    if (os !== 'windows') await chmod(paths.token, 0o600);

    const socket = new SocketServer({ socketPath: paths.socket, token, channelServer: channel });
    await socket.start();

    demo.emitInitialEvents();

    return {
      socketPath: paths.socket,
      tokenPath: paths.token,
      recovery: null,
      attachPort(port) {
        channel.handleConnection(new MessagePortTransport(port));
      },
      attachEnginePort() {
        // The demo serves fake services only: there is no engine to attach.
      },
      async dispose() {
        await socket.close();
        channel.dispose();
        events.dispose();
        await unlink(paths.token).catch(() => undefined);
      },
    };
  }

  const adapters: readonly AgentAdapter[] = options.adapters ?? [
    new ClaudeAdapter(),
    new CodexAdapter(),
    new GeminiAdapter(),
    new OpenCodeAdapter(),
    new AntigravityAdapter(),
  ];
  const defaults = createProcessRunners({ baseEnv: options.baseEnv });
  const runners = {
    doctor: options.runners?.doctor ?? defaults.doctor,
    accounts: options.runners?.accounts ?? defaults.accounts,
  };
  const engine: EngineChildOptions | null =
    options.engine && !options.enginePort
      ? { ...options.engine, env: { ...options.baseEnv }, args: [...options.engine.args, '--engine-dir', paths.engine] }
      : null;
  const pty: PtyHostChildOptions | null = options.pty
    ? { ...options.pty, env: { ...options.baseEnv }, args: [...options.pty.args] }
    : null;

  const services = registerServices({
    paths,
    home: options.home,
    os,
    adapters,
    runners,
    engine,
    pty,
    minFreeBytes: DOCTOR_MIN_FREE_BYTES,
    ...(options.measureFreeBytes ? { measureFreeBytes: options.measureFreeBytes } : {}),
  });

  const events = services.get(ICoreEvents);
  const store = services.get(ICoreStore);
  const config = services.get(ICoreConfig);
  const accounts = services.get(ICoreAccounts);
  const quota = services.get(ICoreQuota);
  const engineService = services.get(ICoreEngine);
  const ptyService = services.get(ICorePty);
  const shellsService = services.get(ICoreShells);
  const doctor = services.get(ICoreDoctor);
  const runs = services.get(ICoreRuns);
  const jobs = services.get(ICoreJobs);
  const review = services.get(ICoreReview);
  const sessions = services.get(ICoreSessions);
  const trust = services.get(ICoreTrust);
  const specs = services.get(ICoreSpecs);
  const bugreport = services.get(ICoreBugReport);

  // BUG-02: Clean up bug reports older than 30 days at start-up
  void cleanOldBugReports(paths.bugReports).catch(() => undefined);

  const opened = await store.open({ dbPath: paths.db, backupDir: paths.backups });
  if (!opened.ok) {
    throw new Error(`${opened.error.message} ${opened.error.fix ?? ''}`.trim());
  }

  // A broken accounts.yaml does not stop the core host: config keeps the last good file
  // and reports the error through lastError().
  await config.start();

  if (options.enginePort) engineService.attachPort(options.enginePort);
  const awaitsEngine = Boolean(options.engine || options.enginePort || options.awaitEnginePort);

  // QTA: limits whose reset time has passed end on each sweep, every minute (quota.sweep). The first sweep is at start-up, below.
  const sweepTimer = setInterval(() => quota.sweep(), QUOTA_SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  const disposables: IDisposable[] = [
    events.attach(accounts.onEvent),
    events.attach(config.onDidChange),
    events.attach(quota.onEvent),
    events.attach(jobs.onEvent),
    events.attach(runs.onEvent),
    events.attach(review.onEvent),
    events.attach(shellsService.onEvent),
    events.attach(sessions.onEvent),
    // QTA-05 / SES-01: an account available again resumes the runs and sessions waiting on it.
    quota.onEvent((event) => {
      if (event.type !== 'quota.available') return;
      void runs.resumeWaitingOn(event.accountId).catch(() => undefined);
      void sessions.onAccountAvailable(event.accountId).catch(() => undefined);
    }),
    events.attach(specs.onEvent),
  ];

  const channel = new ChannelServer(events);
  serve(channel, 'accounts', accounts, CHANNEL_SCHEMAS.accounts);
  serve(channel, 'quota', quota, CHANNEL_SCHEMAS.quota);
  serve(channel, 'doctor', doctor, CHANNEL_SCHEMAS.doctor);
  serve(channel, 'jobs', jobs, CHANNEL_SCHEMAS.jobs);
  serve(channel, 'runs', runs, CHANNEL_SCHEMAS.runs);
  serve(channel, 'review', review, CHANNEL_SCHEMAS.review);
  serve(channel, 'shells', shellsService, CHANNEL_SCHEMAS.shells);
  serve(channel, 'sessions', sessions, CHANNEL_SCHEMAS.sessions);
  serve(channel, 'trust', trust, CHANNEL_SCHEMAS.trust);
  serve(channel, 'specs', specs, CHANNEL_SCHEMAS.specs);
  serve(channel, 'bugreport', bugreport, CHANNEL_SCHEMAS.bugreport);

  // SEC-01: a fresh random token each start, owner-only (0600 on macOS and Linux).
  const token = randomBytes(32).toString('hex');
  await writeFile(paths.token, token, { mode: 0o600 });
  if (os !== 'windows') await chmod(paths.token, 0o600);

  const socket = new SocketServer({ socketPath: paths.socket, token, channelServer: channel });
  await socket.start();

  engineService.start();
  ptyService.start();
  // QTA-04: runs paused by a limit before this start get their auto-resume timers back.
  // A past-due one fires at once, and a resume needs the engine, so wait until it is ready.
  // A limit that ended while orch was closed clears at start-up (quota.sweep). Its
  // quota.available resumes the sessions waiting on that account, which needs the engine,
  // so the sweep comes after the engine is ready.
  if (awaitsEngine) {
    // A failed restore leaves timers unarmed until the next start.
    void engineService.whenReady().then(() => {
      quota.sweep();
      return runs.restoreSchedules();
    }).catch(() => undefined);
  } else {
    quota.sweep();
    await runs.restoreSchedules();
  }

  return {
    socketPath: paths.socket,
    tokenPath: paths.token,
    recovery: opened.value.recovery,
    attachPort(port) {
      channel.handleConnection(new MessagePortTransport(port));
    },
    attachEnginePort(port) {
      engineService.attachPort(port);
    },
    async dispose() {
      await socket.close();
      channel.dispose();
      clearInterval(sweepTimer);
      engineService.dispose();
      ptyService.dispose();
      sessions.dispose();
      specs.dispose();
      runs.dispose();
      accounts.dispose();
      for (const disposable of disposables) disposable.dispose();
      events.dispose();
      store.close();
      await unlink(paths.token).catch(() => undefined);
    },
  };
}

