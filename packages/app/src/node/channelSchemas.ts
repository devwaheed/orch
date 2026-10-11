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
  Job,
  JobId,
  JobSpec,
  PickAccountResult,
  QuotaWindow,
  Run,
  RunId,
  RunLine,
  RoutingRule,
  SignInResult,
} from '@orch/contracts';
import { createMethodSchema, type ServiceSchemaMap } from '@orch/platform/channels/common';

const Void = z.undefined();
const DoctorRunRequest = z.object({ signInTwice: z.boolean().optional() });

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
  lines: createMethodSchema(z.tuple([RunId, z.number().int().nonnegative()]), z.array(RunLine)),
  send: createMethodSchema(z.tuple([RunId, z.string()]), Void),
  pause: createMethodSchema(z.tuple([RunId]), Void),
  stop: createMethodSchema(z.tuple([RunId]), Void),
  startNow: createMethodSchema(z.tuple([RunId]), Void),
  resumeOn: createMethodSchema(z.tuple([RunId, AccountId]), Run),
  setAutoResume: createMethodSchema(z.tuple([RunId, z.boolean()]), Void),
};

/** Schema maps per channel. The events channel needs none: its messages are validated as OrchEvent. */
export const CHANNEL_SCHEMAS: {
  accounts: ServiceSchemaMap;
  quota: ServiceSchemaMap;
  doctor: ServiceSchemaMap;
  jobs: ServiceSchemaMap;
  runs: ServiceSchemaMap;
} = {
  accounts: accountsSchemas,
  quota: quotaSchemas,
  doctor: doctorSchemas,
  jobs: jobsSchemas,
  runs: runsSchemas,
};
