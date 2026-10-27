/**
 * The accounts service: the Accounts screen and the `orch accounts` CLI work
 * through this. It owns no files itself. accounts.yaml goes through the config
 * service, profile folders through the profiles service, and account rows through
 * the store. Agent processes start only through the injected runner port.
 */
import { readdir } from 'node:fs/promises';
import { asc, eq, sql } from 'drizzle-orm';
import { parseDocument, type Document } from 'yaml';
import { Emitter, ok, type Event } from '@orchagents/base';
import {
  AccountId,
  AccountsFile,
  AddAccountRequest,
  AgentId,
  type CommandSpec,
  RoutingRule,
  type Account,
  type AgentAdapter,
  type AgentInfo,
  type IAccountsService,
  type Os,
  type OrchError,
  type OrchEvent,
  type ProviderLogin,
  type Result,
  type ShellId,
  type SignInResult,
} from '@orchagents/contracts';
import type { IConfigService, ConfigSnapshot } from '../../config/common/config.js';
import type { IProfilesService } from '../../profiles/common/profiles.js';
import { filterEngineEnv, shareSkillsFor } from '../../profiles/common/profiles.js';
import type { IStoreService } from '../../store/common/store.js';
import { accountTable } from '../../store/common/schema.js';
import { maskEmail } from '../../adapters/common/maskEmail.js';
import { ACCOUNT_COPY } from '../common/copy.js';
import { primaryToPromote } from '../common/primaries.js';
import {
  accountKey,
  evaluateSignIn,
  oldestFirst,
  supportOnOs,
  type AdapterLookup,
  type IAccountProcessRunner,
  type ProcessRun,
} from '../common/accounts.js';

type Row = typeof accountTable.$inferSelect;

/** A terminal for an agent's own sign-in: started by openSignIn, shown by the UI, its exit code kept for the checks. */
export interface ISignInTerminal {
  open(spec: CommandSpec, cols: number, rows: number): Promise<Result<{ readonly shellId: ShellId; readonly exited: Promise<number | null> }>>;
}

export interface AccountsServiceDeps {
  readonly store: IStoreService;
  readonly config: IConfigService;
  readonly profiles: IProfilesService;
  /** One adapter per agent. Agents without one are left out of listAgents. */
  readonly adapters: readonly AgentAdapter[];
  readonly runner: IAccountProcessRunner;
  /** Runs a sign-in in a terminal the UI shows (the app's PTY host). Absent where there is none (the CLI). */
  readonly terminal?: ISignInTerminal;
  /** The OS this process runs on (ACC-03 support is per OS). */
  readonly os: Os;
  /** The user's real home folder, where each agent's own skills folder lives (ACC-09). */
  readonly homeDir: string;
  readonly now?: () => Date;
}

type Failure = { readonly ok: false; readonly error: OrchError };

function fail(code: OrchError['code'], copy: { readonly message: string; readonly fix?: string }): Failure {
  return { ok: false, error: copy.fix === undefined ? { code, message: copy.message } : { code, message: copy.message, fix: copy.fix } };
}

const SAVE_FAILED = (): Failure => fail('internal', ACCOUNT_COPY.saveFailed);

/** Masked identity from the adapter. Re-masks anything that still looks like a full address (ACC-04). */
function maskIdentity(value: string): string {
  return value.includes('@') && !value.includes('•') ? maskEmail(value) : value;
}

/** Probes adapter capabilities (e.g. OpenCode --standalone) once before building commands. */
async function probeAdapter(adapter: AgentAdapter): Promise<void> {
  if ('probe' in adapter && typeof (adapter as { probe?: unknown }).probe === 'function') {
    await (adapter as { probe: () => Promise<unknown> }).probe();
  }
}

export class AccountsService implements IAccountsService {
  /** Live account events: account.changed and account.removed. */
  readonly onEvent: Event<OrchEvent>;

  private readonly emitter = new Emitter<OrchEvent>();
  private readonly adapters: ReadonlyMap<AgentId, AgentAdapter>;
  private readonly adapterFor: AdapterLookup;
  private readonly now: () => Date;
  /** Exit of each sign-in terminal openSignIn started, read once by checkSignIn. */
  private readonly loginExits = new Map<AccountId, Promise<number | null>>();

  constructor(private readonly deps: AccountsServiceDeps) {
    this.onEvent = this.emitter.event;
    this.adapters = new Map(deps.adapters.map((adapter) => [adapter.id, adapter] as const));
    this.adapterFor = (agent) => this.adapters.get(agent);
    this.now = deps.now ?? (() => new Date());
  }

  dispose(): void {
    this.emitter.dispose();
  }

  // ---------- reads ----------

  async listAgents(): Promise<Result<AgentInfo[]>> {
    const agents = AgentId.options.flatMap((agent) => {
      const adapter = this.adapterFor(agent);
      return adapter ? [adapter] : [];
    });
    const infos = await Promise.all(agents.map((adapter) => this.agentInfo(adapter)));
    return ok(infos);
  }

  async list(): Promise<Result<Account[]>> {
    const config = await this.deps.config.read();
    const parsed = config.ok ? config.value.parsed : this.deps.config.current()?.parsed;
    return ok(this.rows().map((row) => this.toAccount(row, parsed)));
  }

  async getConfig(): Promise<Result<{ text: string; parsed: AccountsFile }>> {
    const config = await this.deps.config.read();
    if (!config.ok) return config;
    return ok({ text: config.value.text, parsed: config.value.parsed });
  }

  // ---------- account lifecycle ----------

  async add(req: AddAccountRequest): Promise<Result<Account>> {
    const parsed = AddAccountRequest.safeParse(req);
    if (!parsed.success) return fail('validation_failed', ACCOUNT_COPY.nameInvalid);
    const { agent, name } = parsed.data;
    const type = parsed.data.type?.trim();
    const adapter = this.adapterFor(agent);
    if (!adapter) return fail('internal', ACCOUNT_COPY.agentUnavailable);

    return this.mutate(async (): Promise<Result<Account>> => {
      const existing = this.rows().filter((row) => row.agent === agent);
      // ACC-03: single-account agents on this OS get one account, never a second.
      if (supportOnOs(adapter, this.deps.os) === 'single' && existing.length > 0) {
        return fail('agent_single_account_os', ACCOUNT_COPY.singleAccountOs(adapter.displayName, this.deps.os));
      }

      const config = await this.deps.config.read();
      if (!config.ok) return config;
      const originalText = config.value.text;

      const created = await this.deps.profiles.create({
        agent,
        name,
        shareSkills: shareSkillsFor(config.value.parsed.share_skills, agent),
      });
      if (!created.ok) return created;
      const { accountId } = created.value;

      // ACC-05: the first account added becomes primary.
      const isPrimary = existing.length === 0;
      const edited = await this.editConfig((doc) => {
        doc.setIn(['accounts', agent, accountKey(accountId, agent)], {
          ...(isPrimary ? { primary: true } : {}),
          ...(type ? { type } : {}),
        });
      });
      if (!edited.ok) {
        await this.deps.profiles.remove(accountId);
        return edited;
      }

      try {
        this.db().insert(accountTable).values({
          id: accountId,
          agent,
          name,
          isPrimary,
          useEnabled: true,
          state: 'signed_out',
          profileDir: created.value.profileDir,
          skillsShared: created.value.skillsShared,
          createdAt: this.nowIso(),
        }).run();
      } catch {
        await this.deps.profiles.remove(accountId);
        await this.deps.config.setText(originalText);
        return SAVE_FAILED();
      }

      const row = this.findRow(accountId);
      if (!row) return SAVE_FAILED();
      return ok(this.toAccount(row, this.deps.config.current()?.parsed));
    });
  }

  async signIn(accountId: AccountId): Promise<Result<SignInResult>> {
    const row = this.findRow(accountId);
    if (!row) return fail('not_found', ACCOUNT_COPY.notFound);
    const adapter = this.adapterFor(row.agent);
    if (!adapter) return fail('internal', ACCOUNT_COPY.agentUnavailable);

    return this.mutate(async (): Promise<Result<SignInResult>> => {
      await probeAdapter(adapter);
      // Sign-in runs the agent's own login. orch never reads the credentials it writes.
      const login = await this.deps.runner.run(this.scoped(adapter.loginCommand(row.profileDir, this.deps.os)), {
        interactive: true,
      });
      if (login === null) {
        return fail('agent_not_installed', ACCOUNT_COPY.agentCannotStart(adapter.displayName, adapter.command));
      }
      return ok(await this.runSignInChecks(row, adapter, login.exitCode === 0));
    });
  }

  async openSignIn(accountId: AccountId, cols: number, rows: number): Promise<Result<ShellId>> {
    const row = this.findRow(accountId);
    if (!row) return fail('not_found', ACCOUNT_COPY.notFound);
    const adapter = this.adapterFor(row.agent);
    if (!adapter) return fail('internal', ACCOUNT_COPY.agentUnavailable);
    if (!this.deps.terminal) return fail('internal', ACCOUNT_COPY.agentCannotStart(adapter.displayName, adapter.command));
    await probeAdapter(adapter);
    // Started in the account's own folder, so an agent that asks to trust its folder asks about that one.
    const spec = this.scoped(adapter.loginCommand(row.profileDir, this.deps.os));
    const opened = await this.deps.terminal.open({ ...spec, cwd: spec.cwd ?? row.profileDir }, cols, rows);
    if (!opened.ok) return fail('agent_not_installed', ACCOUNT_COPY.agentCannotStart(adapter.displayName, adapter.command));
    this.loginExits.set(accountId, opened.value.exited);
    return ok(opened.value.shellId);
  }

  async checkSignIn(accountId: AccountId, userConfirmed: boolean): Promise<Result<SignInResult>> {
    const row = this.findRow(accountId);
    if (!row) return fail('not_found', ACCOUNT_COPY.notFound);
    const adapter = this.adapterFor(row.agent);
    if (!adapter) return fail('internal', ACCOUNT_COPY.agentUnavailable);
    const exit = this.loginExits.get(accountId);
    this.loginExits.delete(accountId);
    const loginOk = userConfirmed || (exit !== undefined && (await exit) === 0);
    return this.mutate(async () => ok(await this.runSignInChecks(row, adapter, loginOk)));
  }

  /**
   * The three checks after a sign-in. An agent with a status command is asked whether it is
   * signed in, whatever the login's exit code; one without it counts as signed in when its
   * login ended normally.
   */
  private async runSignInChecks(row: Row, adapter: AgentAdapter, loginOk: boolean): Promise<SignInResult> {
    await probeAdapter(adapter);
    const accountId = row.id as AccountId;
    const whoAmI = adapter.whoAmICommand(row.profileDir, this.deps.os);
    let statusSignedIn = false;
    let identity: string | null = null;
    let plan: string | undefined;
    let providers: ProviderLogin[] | undefined;
    if (whoAmI !== null) {
      const probe = await this.deps.runner.run(this.scoped(whoAmI), { interactive: false });
      // Some agents print their status to stderr (codex login status).
      const output = probe === null ? '' : `${probe.stdout}\n${probe.stderr ?? ''}`;
      const found = probe === null || probe.exitCode !== 0 ? null : adapter.parseWhoAmI(output);
      if (found) {
        statusSignedIn = true;
        identity = found.emailMasked === undefined ? null : maskIdentity(found.emailMasked);
        plan = found.plan;
      }
      if (probe !== null && adapter.parseProviders) {
        providers = adapter.parseProviders(probe.stdout);
      }
    }

    const envInside = (await this.deps.profiles.sessionEnv(accountId)).ok;
    const others = this.rows()
      .filter((other) => other.agent === row.agent && other.id !== accountId)
      .map((other) => ({ id: other.id as AccountId, emailMasked: other.emailMasked }));

    const outcome = evaluateSignIn({
      loginOk,
      identityCheckAvailable: whoAmI !== null,
      statusSignedIn,
      emailMasked: identity,
      envInsideProfile: envInside,
      others,
    });

    this.db()
      .update(accountTable)
      .set({
        state: outcome.ready ? 'available' : 'signed_out',
        emailMasked: outcome.emailMasked ?? row.emailMasked,
        plan: plan ?? row.plan,
        ...(providers === undefined ? {} : { providers }),
        lastIsolationCheck: { at: this.nowIso(), ok: outcome.keptSeparate },
      })
      .where(eq(accountTable.id, accountId))
      .run();

    return {
      accountId,
      signedIn: outcome.signedIn,
      ...(outcome.emailMasked === null ? {} : { emailMasked: outcome.emailMasked }),
      keptSeparate: outcome.keptSeparate,
      ready: outcome.ready,
      identity: outcome.identityKnown ? 'checked' : 'unknown',
    };
  }

  async setPrimary(accountId: AccountId): Promise<Result<void>> {
    const row = this.findRow(accountId);
    if (!row) return fail('not_found', ACCOUNT_COPY.notFound);
    const agent = row.agent;
    return this.mutate(async () => {
      const edited = await this.editConfig((doc) => {
        for (const other of this.rows()) {
          if (other.agent !== agent || other.id === accountId) continue;
          const key = accountKey(other.id, agent);
          if (doc.getIn(['accounts', agent, key, 'primary']) === true) {
            doc.setIn(['accounts', agent, key, 'primary'], false);
          }
        }
        doc.setIn(['accounts', agent, accountKey(accountId, agent), 'primary'], true);
      });
      return edited.ok ? ok(undefined) : edited;
    });
  }

  async setUse(accountId: AccountId, use: boolean): Promise<Result<void>> {
    const row = this.findRow(accountId);
    if (!row) return fail('not_found', ACCOUNT_COPY.notFound);
    if (typeof use !== 'boolean') return fail('validation_failed', ACCOUNT_COPY.useInvalid);
    return this.mutate(async () => {
      const edited = await this.editConfig((doc) => {
        doc.setIn(['accounts', row.agent, accountKey(accountId, row.agent), 'use'], use);
      });
      return edited.ok ? ok(undefined) : edited;
    });
  }

  async setRouting(rule: RoutingRule): Promise<Result<void>> {
    const parsed = RoutingRule.safeParse(rule);
    if (!parsed.success) return fail('validation_failed', ACCOUNT_COPY.routingInvalid);
    return this.mutate(async () => {
      const edited = await this.editConfig((doc) => {
        doc.setIn(['routing'], parsed.data);
      });
      return edited.ok ? ok(undefined) : edited;
    });
  }

  async setShareSkills(agent: AgentId, share: boolean): Promise<Result<void>> {
    const parsedAgent = AgentId.safeParse(agent);
    if (!parsedAgent.success || typeof share !== 'boolean') return fail('validation_failed', ACCOUNT_COPY.shareInvalid);
    const config = await this.deps.config.read();
    if (!config.ok) return config;
    const current = config.value.parsed.share_skills;

    return this.mutate(async () => {
      // ACC-09: one boolean for all agents, or a per-agent map. Only the changed agent moves.
      const edited = await this.editConfig((doc) => {
        if (typeof current === 'boolean') {
          if (current === share) return;
          const map: Record<string, boolean> = {};
          for (const id of AgentId.options) map[id] = shareSkillsFor(current, id);
          map[agent] = share;
          doc.setIn(['share_skills'], map);
          return;
        }
        doc.setIn(['share_skills', agent], share);
      });
      if (!edited.ok) return edited;

      for (const row of this.rows().filter((r) => r.agent === agent)) {
        const linked = await this.deps.profiles.setSharedSkills(row.id, share);
        if (!linked.ok) return linked;
        this.db().update(accountTable).set({ skillsShared: linked.value }).where(eq(accountTable.id, row.id)).run();
      }
      return ok(undefined);
    });
  }

  async remove(accountId: AccountId): Promise<Result<void>> {
    const row = this.findRow(accountId);
    if (!row) return fail('not_found', ACCOUNT_COPY.notFound);
    return this.mutate(async () => {
      const config = await this.deps.config.read();
      if (!config.ok) return config;
      const originalText = config.value.text;

      // ACC-05: drop the entry, then make the oldest remaining account of each agent primary if needed.
      const remaining = oldestFirst(this.rows().filter((r) => r.id !== accountId));
      const edited = await this.editConfig((doc) => {
        doc.deleteIn(['accounts', row.agent, accountKey(accountId, row.agent)]);
        if (!remaining.some((r) => r.agent === row.agent)) doc.deleteIn(['accounts', row.agent]);
        this.ensurePrimaries(doc, remaining);
      });
      if (!edited.ok) return edited;

      // ACC-08: deletes the profile folder only.
      const removed = await this.deps.profiles.remove(accountId);
      if (!removed.ok) {
        await this.deps.config.setText(originalText);
        return removed;
      }
      this.db().delete(accountTable).where(eq(accountTable.id, accountId)).run();
      return ok(undefined);
    });
  }

  async setConfig(text: string): Promise<Result<AccountsFile>> {
    return this.mutate(async () => {
      const doc = parseDocument(text);
      // Invalid YAML or schema problems come back from the config service with field errors.
      if (doc.errors.length > 0) {
        const rejected = await this.deps.config.setText(text);
        return rejected.ok ? ok(rejected.value.parsed) : rejected;
      }
      try {
        this.ensurePrimaries(doc, oldestFirst(this.rows()));
      } catch {
        const rejected = await this.deps.config.setText(text);
        return rejected.ok ? ok(rejected.value.parsed) : rejected;
      }
      const saved = await this.deps.config.setText(doc.toString());
      return saved.ok ? ok(saved.value.parsed) : saved;
    });
  }

  // ---------- internals ----------

  private db() {
    return this.deps.store.db;
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private rows(): Row[] {
    return this.db()
      .select()
      .from(accountTable)
      .orderBy(asc(accountTable.createdAt), asc(sql`rowid`))
      .all();
  }

  private findRow(accountId: string): Row | undefined {
    return this.rows().find((row) => row.id === accountId);
  }

  private toAccount(row: Row, parsed: AccountsFile | undefined): Account {
    const agent = row.agent;
    const entry = parsed?.accounts[agent]?.[accountKey(row.id, agent)];
    const account: Account = {
      id: row.id as AccountId,
      agent,
      name: row.name,
      primary: entry?.primary === true,
      use: entry?.use !== false,
      state: row.state,
      profileDir: row.profileDir,
      skillsShared: row.skillsShared,
    };
    if (row.emailMasked !== null) account.emailMasked = row.emailMasked;
    if (row.plan !== null) account.plan = row.plan;
    if (entry?.type !== undefined) account.type = entry.type;
    if (row.providers !== null) account.providers = row.providers;
    if (row.lastIsolationCheck !== null) account.lastIsolationCheck = row.lastIsolationCheck;
    return account;
  }

  private accountMap(): Map<string, Account> {
    const parsed = this.deps.config.current()?.parsed;
    return new Map(this.rows().map((row) => [row.id, this.toAccount(row, parsed)] as const));
  }

  /** Runs a mutation, keeps the store's flags in step with the file, and emits what changed. */
  private async mutate<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    const before = this.accountMap();
    let result: Result<T>;
    try {
      result = await work();
    } catch {
      result = SAVE_FAILED();
    }
    try {
      this.syncRowFlags();
    } catch {
      // The flags are a cache of the file; the next mutation or listing corrects them.
    }
    this.publish(before);
    return result;
  }

  private publish(before: ReadonlyMap<string, Account>): void {
    const after = this.accountMap();
    const events: OrchEvent[] = [];
    for (const id of before.keys()) {
      if (!after.has(id)) events.push({ type: 'account.removed', accountId: id as AccountId });
    }
    for (const [id, account] of after) {
      const previous = before.get(id);
      if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(account)) {
        events.push({ type: 'account.changed', account });
      }
    }
    for (const event of events) {
      try {
        this.emitter.fire(event);
      } catch {
        // A listener failing must not undo the change that already happened.
      }
    }
  }

  private syncRowFlags(): void {
    const parsed = this.deps.config.current()?.parsed;
    if (!parsed) return;
    for (const row of this.rows()) {
      const entry = parsed.accounts[row.agent]?.[accountKey(row.id, row.agent)];
      const isPrimary = entry?.primary === true;
      const useEnabled = entry?.use !== false;
      if (row.isPrimary !== isPrimary || row.useEnabled !== useEnabled) {
        this.db()
          .update(accountTable)
          .set({ isPrimary, useEnabled })
          .where(eq(accountTable.id, row.id))
          .run();
      }
    }
  }

  /** Reads the file fresh, applies one edit, and writes it back. Comments and key order are kept. */
  private async editConfig(edit: (doc: Document) => void): Promise<Result<ConfigSnapshot>> {
    const config = await this.deps.config.read();
    if (!config.ok) return config;
    const doc = parseDocument(config.value.text);
    if (doc.errors.length > 0) return this.deps.config.setText(config.value.text);
    edit(doc);
    return this.deps.config.setText(doc.toString());
  }

  /** ACC-05 on a YAML document: every agent with accounts keeps exactly one primary. */
  private ensurePrimaries(doc: Document, candidates: readonly Row[]): void {
    const promote = primaryToPromote(
      candidates.map((row) => ({ id: row.id as AccountId, agent: row.agent, createdAt: row.createdAt })),
      (id) => {
        const agent = candidates.find((row) => row.id === id)?.agent;
        return agent !== undefined && doc.getIn(['accounts', agent, accountKey(id, agent), 'primary']) === true;
      },
    );
    for (const [agent, id] of promote) {
      doc.setIn(['accounts', agent, accountKey(id, agent), 'primary'], true);
    }
  }

  private async restoreConfig(text: string): Promise<void> {
    await this.deps.config.setText(text);
  }

  /** Drops any variable a session may not receive before the process starts (ENGINE_ENV_ALLOWLIST). */
  private scoped(spec: CommandSpec): CommandSpec {
    return { ...spec, env: filterEngineEnv(spec.env) };
  }

  private async agentInfo(adapter: AgentAdapter): Promise<AgentInfo> {
    const os = this.deps.os;
    const probe: ProcessRun | null = await this.deps.runner.run(
      { argv: [adapter.command, '--version'], env: {} },
      { interactive: false },
    );
    const version =
      probe !== null && probe.exitCode === 0
        ? probe.stdout.split('\n').map((line) => line.trim()).find((line) => line.length > 0)
        : undefined;
    const installed = probe !== null && probe.exitCode === 0;

    const skillsDir = adapter.sharedSkillsDir(this.deps.homeDir, os);
    const skillNames = skillsDir === null ? [] : await listEntries(skillsDir);
    const info: AgentInfo = {
      id: adapter.id,
      displayName: adapter.displayName,
      command: adapter.command,
      installed,
      support: supportOnOs(adapter, os),
      supportByOs: { ...adapter.supportByOs },
      accountSetting: adapter.accountSetting,
      sharedSkillsDir: skillsDir,
      sharedSkillsCount: skillNames.length,
      sharedSkillNames: skillNames,
    };
    if (version !== undefined) info.version = version;
    return info;
  }
}

async function listEntries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

