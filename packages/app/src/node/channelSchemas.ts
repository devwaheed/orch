/**
 * Zod schemas for the arguments and results of every method the core host serves
 * over the channel (contracts: services.ts, CHANNELS). Each side validates with
 * these, so nothing malformed crosses the socket.
 */
import { z } from 'zod';
import {
  AccountId,
  AccountsFile,
  AddAccountRequest,
  Account,
  AgentId,
  AgentInfo,
  DoctorReport,
  DoctorRunRequest,
  Job,
  JobId,
  JobSpec,
  PickAccountResult,
  QuotaWindow,
  Run,
  RunId,
  RunLine,
  ResumeOption,
  ResumeRequest,
  RoutingRule,
  ShellId,
  Session,
  SessionId,
  QueueId,
  SignInResult,
  SpecId,
  SpecInitReport,
  SpecLoadProblem,
  SpecQueue,
  SpecQueueSettings,
} from '@orch/contracts';
import { createMethodSchema, type ServiceSchemaMap } from '@orch/platform/channels/common';

const Void = z.undefined();

export const accountsSchemas = {
  listAgents: createMethodSchema(z.tuple([]), z.array(AgentInfo)),
  list: createMethodSchema(z.tuple([]), z.array(Account)),
  add: createMethodSchema(z.tuple([AddAccountRequest]), Account),
  signIn: createMethodSchema(z.tuple([AccountId]), SignInResult),
  setPrimary: createMethodSchema(z.tuple([AccountId]), Void),
  setUse: createMethodSchema(z.tuple([AccountId, z.boolean()]), Void),
  setRouting: createMethodSchema(z.tuple([RoutingRule]), Void),
  setShareSkills: createMethodSchema(z.tuple([AgentId, z.boolean()]), Void),
  remove: createMethodSchema(z.tuple([AccountId]), Void),
  getConfig: createMethodSchema(z.tuple([]), z.object({ text: z.string(), parsed: AccountsFile })),
  setConfig: createMethodSchema(z.tuple([z.string()]), AccountsFile),
};

export const quotaSchemas = {
  windows: createMethodSchema(z.tuple([]), z.array(QuotaWindow)),
  pickAccount: createMethodSchema(z.tuple([AgentId]), PickAccountResult),
};

export const doctorSchemas = {
  run: createMethodSchema(z.union([z.tuple([]), z.tuple([DoctorRunRequest])]), DoctorReport),
};

export const jobsSchemas = {
  start: createMethodSchema(z.tuple([JobSpec]), Job),
  list: createMethodSchema(z.tuple([]), z.array(Job)),
  get: createMethodSchema(z.tuple([JobId]), Job),
  cancel: createMethodSchema(z.tuple([JobId]), Void),
  toCommand: createMethodSchema(z.tuple([JobSpec]), z.string()),
};

export const runsSchemas = {
  list: createMethodSchema(z.tuple([JobId]), z.array(Run)),
  lines: createMethodSchema(z.tuple([RunId, z.number().int().min(-1)]), z.array(RunLine)),
  send: createMethodSchema(z.tuple([RunId, z.string()]), Void),
  pause: createMethodSchema(z.tuple([RunId]), Void),
  stop: createMethodSchema(z.tuple([RunId]), Void),
  startNow: createMethodSchema(z.tuple([RunId]), Void),
  resumeOn: createMethodSchema(z.tuple([RunId, AccountId]), Run),
  setAutoResume: createMethodSchema(z.tuple([RunId, z.boolean()]), Void),
};

export const shellsSchemas = {
  open: createMethodSchema(z.tuple([z.string(), z.number().int().positive(), z.number().int().positive()]), ShellId),
  write: createMethodSchema(z.tuple([ShellId, z.string()]), Void),
  resize: createMethodSchema(z.tuple([ShellId, z.number().int().positive(), z.number().int().positive()]), Void),
  close: createMethodSchema(z.tuple([ShellId]), Void),
};

export const sessionsSchemas = {
  list: createMethodSchema(z.tuple([z.enum(['all', 'resumable', 'live'])]), z.array(Session)),
  get: createMethodSchema(z.tuple([SessionId]), Session),
  resumeOptions: createMethodSchema(z.tuple([SessionId]), z.array(ResumeOption)),
  resume: createMethodSchema(z.tuple([ResumeRequest]), Session),
};

export const specsSchemas = {
  init: createMethodSchema(z.tuple([z.string()]), SpecInitReport),
  load: createMethodSchema(
    z.tuple([z.string()]),
    z.object({ queue: SpecQueue.nullable(), problems: z.array(SpecLoadProblem) }),
  ),
  get: createMethodSchema(z.tuple([QueueId]), SpecQueue),
  start: createMethodSchema(z.tuple([QueueId]), Void),
  pause: createMethodSchema(z.tuple([QueueId]), Void),
  resume: createMethodSchema(z.tuple([QueueId]), Void),
  cancel: createMethodSchema(z.tuple([QueueId]), Void),
  updateSettings: createMethodSchema(z.tuple([QueueId, SpecQueueSettings.partial()]), SpecQueueSettings),
  move: createMethodSchema(z.tuple([QueueId, SpecId, z.number().int().min(1)]), Void),
  skip: createMethodSchema(z.tuple([QueueId, SpecId]), Void),
  retry: createMethodSchema(z.tuple([QueueId, SpecId]), Void),
};

/** Schema maps per channel. The events channel needs none: its messages are validated as OrchEvent. */
export const CHANNEL_SCHEMAS: {
  accounts: ServiceSchemaMap;
  quota: ServiceSchemaMap;
  doctor: ServiceSchemaMap;
  jobs: ServiceSchemaMap;
  runs: ServiceSchemaMap;
  shells: ServiceSchemaMap;
  sessions: ServiceSchemaMap;
  specs: ServiceSchemaMap;
} = {
  accounts: accountsSchemas,
  quota: quotaSchemas,
  doctor: doctorSchemas,
  jobs: jobsSchemas,
  runs: runsSchemas,
  shells: shellsSchemas,
  sessions: sessionsSchemas,
  specs: specsSchemas,
};
