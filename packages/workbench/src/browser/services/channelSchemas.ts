/**
 * Method schemas and typed service proxies for the browser side of the channel.
 *
 * Every argument and reply is checked against the contracts schemas. The
 * workbench may not import zod, so the parsers below use the contract schemas
 * directly (they are zod objects with safeParse) plus a few primitive checks.
 * Each channel's spec is typed against its service interface, so a method added
 * to the contract without a spec fails `pnpm typecheck`.
 */
import {
  Account,
  AccountId,
  AccountsFile,
  AddAccountRequest,
  AgentId,
  AgentInfo,
  CorrectionLayer,
  DoctorReport,
  DoctorRunRequest,
  Job,
  JobId,
  JobSpec,
  PickAccountResult,
  QuotaWindow,
  QueueId,
  ResumeOption,
  ResumeRequest,
  Run,
  RunId,
  RunLine,
  RoutingRule,
  Session,
  SessionId,
  ShellId,
  SignInResult,
  SpecId,
  SpecInitReport,
  SpecLoadProblem,
  SpecQueue,
  SpecQueueSettings,
  SpendToday,
  TrustLevel,
  TrustSummary,
  WorktreeId,
  WorktreeReview,
  type IAccountsService,
  type IDoctorService,
  type IJobsService,
  type IQuotaService,
  type IReviewService,
  type IRunsService,
  type ISessionsService,
  type ISpecsService,
  type IShellService,
  type ITrustService,
  type OrchServices,
  type Result,
} from '@orch/contracts';
import type { BrowserChannelClient, MethodSpec, Parser } from './channelClient.js';

/** One MethodSpec per method of service interface T, keyed the same way. */
export type ServiceSpec<T> = {
  readonly [K in keyof T]: T[K] extends (...args: infer A extends readonly unknown[]) => Promise<Result<infer R>>
    ? MethodSpec<A, R>
    : never;
};

function fail(message: string): { success: false; error: { message: string } } {
  return { success: false, error: { message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function primitive<T>(check: (value: unknown) => value is T, label: string): Parser<T> {
  return {
    safeParse(value) {
      return check(value) ? { success: true, data: value } : fail(`Expected ${label}`);
    },
  };
}

export const stringP: Parser<string> = primitive((v): v is string => typeof v === 'string', 'a string');
export const booleanP: Parser<boolean> = primitive((v): v is boolean => typeof v === 'boolean', 'a boolean');
export const intP: Parser<number> = primitive(
  (v): v is number => typeof v === 'number' && Number.isInteger(v),
  'an integer',
);
export const nonNegIntP: Parser<number> = primitive(
  (v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0,
  'a whole number',
);
/** runs.lines afterSeq: exclusive, so -1 reads from the first line (seq 0). */
export const afterSeqP: Parser<number> = primitive(
  (v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= -1,
  'a whole number or -1',
);
export const voidP: Parser<void> = {
  safeParse(value) {
    return value === undefined ? { success: true, data: undefined } : fail('Expected no value');
  },
};

export function oneOf<T extends string | number>(values: readonly T[]): Parser<T> {
  return primitive((v): v is T => (values as readonly unknown[]).includes(v), values.join(' | '));
}

export function arrayOf<T>(item: Parser<T>): Parser<T[]> {
  return {
    safeParse(value) {
      if (!Array.isArray(value)) {
        return fail('Expected a list');
      }
      const out: T[] = [];
      for (const entry of value) {
        const parsed = item.safeParse(entry);
        if (!parsed.success) {
          return parsed;
        }
        out.push(parsed.data);
      }
      return { success: true, data: out };
    },
  };
}

/** An optional trailing argument: undefined passes, anything else must match `item`. */
export function optionalP<T>(item: Parser<T>): Parser<T | undefined> {
  return {
    safeParse(value) {
      return value === undefined ? { success: true, data: undefined } : item.safeParse(value);
    },
  };
}

export function nullableP<T>(item: Parser<T>): Parser<T | null> {
  return {
    safeParse(value) {
      return value === null ? { success: true, data: null } : item.safeParse(value);
    },
  };
}

/** An object whose listed fields are each checked. Unlisted fields are dropped, as zod does. */
export function shape<T extends Record<string, unknown>>(fields: { readonly [K in keyof T]: Parser<T[K]> }): Parser<T> {
  const entries = Object.entries(fields as unknown as Record<string, Parser<unknown>>);
  return {
    safeParse(value) {
      if (!isRecord(value)) {
        return fail('Expected an object');
      }
      const out: Record<string, unknown> = {};
      for (const [key, parser] of entries) {
        const parsed = parser.safeParse(value[key]);
        if (!parsed.success) {
          return fail(`${key}: ${parsed.error.message}`);
        }
        out[key] = parsed.data;
      }
      return { success: true, data: out as T };
    },
  };
}

const AccountsConfig = shape<{ text: string; parsed: AccountsFile }>({
  text: stringP,
  parsed: AccountsFile,
});

const AccountsSpec: ServiceSpec<IAccountsService> = {
  listAgents: { args: [], result: arrayOf(AgentInfo) },
  list: { args: [], result: arrayOf(Account) },
  add: { args: [AddAccountRequest], result: Account },
  signIn: { args: [AccountId], result: SignInResult },
  setPrimary: { args: [AccountId], result: voidP },
  setUse: { args: [AccountId, booleanP], result: voidP },
  setRouting: { args: [RoutingRule], result: voidP },
  setShareSkills: { args: [AgentId, booleanP], result: voidP },
  remove: { args: [AccountId], result: voidP },
  getConfig: { args: [], result: AccountsConfig },
  setConfig: { args: [stringP], result: AccountsFile },
};

const QuotaSpec: ServiceSpec<IQuotaService> = {
  windows: { args: [], result: arrayOf(QuotaWindow) },
  pickAccount: { args: [AgentId], result: PickAccountResult },
  spendToday: { args: [], result: SpendToday },
};

const JobsSpec: ServiceSpec<IJobsService> = {
  start: { args: [JobSpec], result: Job },
  list: { args: [], result: arrayOf(Job) },
  get: { args: [JobId], result: Job },
  approvePlan: { args: [JobId], result: voidP },
  rejectPlan: { args: [JobId, optionalP(stringP)], result: voidP },
  cancel: { args: [JobId], result: voidP },
  toCommand: { args: [JobSpec], result: stringP },
};

const RunsSpec: ServiceSpec<IRunsService> = {
  list: { args: [JobId], result: arrayOf(Run) },
  lines: { args: [RunId, afterSeqP], result: arrayOf(RunLine) },
  send: { args: [RunId, stringP], result: voidP },
  pause: { args: [RunId], result: voidP },
  stop: { args: [RunId], result: voidP },
  startNow: { args: [RunId], result: voidP },
  resumeOn: { args: [RunId, AccountId], result: Run },
  setAutoResume: { args: [RunId, booleanP], result: voidP },
};

const SessionsSpec: ServiceSpec<ISessionsService> = {
  list: { args: [oneOf(['all', 'resumable', 'live'] as const)], result: arrayOf(Session) },
  get: { args: [SessionId], result: Session },
  resumeOptions: { args: [SessionId], result: arrayOf(ResumeOption) },
  resume: { args: [ResumeRequest], result: Session },
};

const ReviewSpec: ServiceSpec<IReviewService> = {
  list: { args: [], result: arrayOf(WorktreeReview) },
  get: { args: [WorktreeId], result: WorktreeReview },
  diff: {
    args: [WorktreeId, stringP],
    result: shape<{ before: string; after: string }>({ before: stringP, after: stringP }),
  },
  approveAndMerge: { args: [WorktreeId], result: voidP },
  requestChanges: { args: [WorktreeId, stringP], result: voidP },
  discard: { args: [WorktreeId], result: voidP },
  correct: {
    args: [WorktreeId, CorrectionLayer, stringP],
    result: shape<{ followUpJobId: JobId | null }>({ followUpJobId: JobId.nullable() }),
  },
};

const TrustSpec: ServiceSpec<ITrustService> = {
  summary: { args: [oneOf([7, 30] as const)], result: TrustSummary },
  promote: { args: [AgentId, TrustLevel], result: voidP },
  setGardener: { args: [booleanP], result: voidP },
};

const ShellSpec: ServiceSpec<IShellService> = {
  open: { args: [stringP, intP, intP], result: ShellId },
  write: { args: [ShellId, stringP], result: voidP },
  resize: { args: [ShellId, intP, intP], result: voidP },
  close: { args: [ShellId], result: voidP },
};

const DoctorSpec: ServiceSpec<IDoctorService> = {
  run: { args: [optionalP(DoctorRunRequest)], result: DoctorReport },
};

/**
 * A partial settings patch. zod leaves absent keys as undefined; they are dropped so
 * the value matches Partial<SpecQueueSettings> under exactOptionalPropertyTypes.
 */
const SettingsPatch: Parser<Partial<SpecQueueSettings>> = {
  safeParse(value) {
    const parsed = SpecQueueSettings.partial().safeParse(value);
    if (!parsed.success) {
      return parsed;
    }
    const patch: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(parsed.data)) {
      if (entry !== undefined) {
        patch[key] = entry;
      }
    }
    return { success: true, data: patch as Partial<SpecQueueSettings> };
  },
};

const SpecsSpec: ServiceSpec<ISpecsService> = {
  load: {
    args: [stringP],
    result: shape<{ queue: SpecQueue | null; problems: SpecLoadProblem[] }>({
      queue: nullableP(SpecQueue),
      problems: arrayOf(SpecLoadProblem),
    }),
  },
  get: { args: [QueueId], result: SpecQueue },
  init: { args: [stringP], result: SpecInitReport },
  cancel: { args: [QueueId], result: voidP },
  start: { args: [QueueId], result: voidP },
  pause: { args: [QueueId], result: voidP },
  resume: { args: [QueueId], result: voidP },
  updateSettings: { args: [QueueId, SettingsPatch], result: SpecQueueSettings },
  move: { args: [QueueId, SpecId, nonNegIntP], result: voidP },
  skip: { args: [QueueId, SpecId], result: voidP },
  retry: { args: [QueueId, SpecId], result: voidP },
};

/** Every channel except events, which the client handles itself. */
export type CoreServices = Omit<OrchServices, 'events'>;

export const CORE_SPECS = {
  accounts: AccountsSpec,
  quota: QuotaSpec,
  jobs: JobsSpec,
  runs: RunsSpec,
  sessions: SessionsSpec,
  review: ReviewSpec,
  trust: TrustSpec,
  shells: ShellSpec,
  doctor: DoctorSpec,
  specs: SpecsSpec,
} as const;

/** Builds a typed proxy for one channel. Every call resolves to Result<T>. */
function serviceProxy<T>(client: BrowserChannelClient, channel: keyof CoreServices, spec: ServiceSpec<T>): T {
  const methods = spec as unknown as Record<string, MethodSpec>;
  const proxy: Record<string, (...args: unknown[]) => Promise<Result<unknown>>> = {};
  for (const name of Object.keys(methods)) {
    const methodSpec = methods[name];
    proxy[name] = (...args: unknown[]) => client.call(channel, name, args, methodSpec);
  }
  return proxy as unknown as T;
}

/** Typed proxies for every core channel, bound to one connected client. */
export function createCoreServices(client: BrowserChannelClient): CoreServices {
  return {
    accounts: serviceProxy<IAccountsService>(client, 'accounts', CORE_SPECS.accounts),
    quota: serviceProxy<IQuotaService>(client, 'quota', CORE_SPECS.quota),
    jobs: serviceProxy<IJobsService>(client, 'jobs', CORE_SPECS.jobs),
    runs: serviceProxy<IRunsService>(client, 'runs', CORE_SPECS.runs),
    sessions: serviceProxy<ISessionsService>(client, 'sessions', CORE_SPECS.sessions),
    review: serviceProxy<IReviewService>(client, 'review', CORE_SPECS.review),
    trust: serviceProxy<ITrustService>(client, 'trust', CORE_SPECS.trust),
    shells: serviceProxy<IShellService>(client, 'shells', CORE_SPECS.shells),
    doctor: serviceProxy<IDoctorService>(client, 'doctor', CORE_SPECS.doctor),
    specs: serviceProxy<ISpecsService>(client, 'specs', CORE_SPECS.specs),
  };
}
