/**
 * The gardener (TRU-04): a weekly single-mode job on the primary account of the
 * highest-level agent. The job's proposals reach Review like any other job.
 * Time, accounts, levels and job creation arrive through the constructor so the
 * schedule and account choice are tested with fakes.
 *
 * The gardener's goal text and repo path are not in the docs yet; they are
 * passed in by the composition root and never defaulted here.
 */
import {
  JobSpec,
  type Account,
  type IAccountsService,
  type IJobsService,
  type Job,
  type OrchError,
  type Result,
  type Timestamp,
} from '@orch/contracts';
import type { ITrustGardenerSource, ITrustLevelStore, TrustGardenerFinding, TrustGardenerState } from '../../common/ports.js';
import { START_LEVEL } from '../../common/constants.js';
import { chooseGardenerAccount } from '../common/choice.js';
import { nextGardenerRun } from '../common/schedule.js';

export interface GardenerDeps {
  readonly accounts: Pick<IAccountsService, 'list'>;
  readonly levels: Pick<ITrustLevelStore, 'levelOf'>;
  readonly jobs: Pick<IJobsService, 'start'>;
  /** The gardener's goal, from the product docs (open question; see the S4-05 report). */
  readonly goal: string;
  /** The repository the gardener reviews. */
  readonly repoPath: string;
  /** Injected so the schedule tests can move time. */
  readonly clock: () => Date;
  /** IANA zone name, e.g. `Europe/London`. Defaults to the machine's zone at the composition root. */
  readonly timeZone: () => string;
}

/** A timer the scheduler arms for the next run. Injected so tests run without real time. */
export interface GardenerTimers {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

const gardenerError = (message: string, fix: string): OrchError => ({ code: 'internal', message, fix });

export class GardenerService implements ITrustGardenerSource {
  private on = true;
  private timer: unknown = null;
  private dueAt = 0;
  private running = false;
  private readonly findings: TrustGardenerFinding[] = [];

  constructor(
    private readonly deps: GardenerDeps,
    private readonly timers: GardenerTimers = {
      set: (callback, delayMs) => setTimeout(callback, delayMs),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  ) {}

  /** The Trust screen's gardener card (TRU-04). `nextRunAt` is null while off. */
  state(): TrustGardenerState {
    const nextRunAt = this.on ? this.nextRun().toISOString() as Timestamp : null;
    return { on: this.on, nextRunAt, findings: [...this.findings] };
  }

  /** Turns the gardener on or off. Off stops the timer; on arms it for the next Monday. */
  setOn(on: boolean): void {
    this.on = on;
    this.arm();
  }

  /** Arms the timer for the next run. Call once at start-up. */
  start(): void {
    this.arm();
  }

  /** Stops the timer. */
  stop(): void {
    this.disarm();
  }

  /**
   * Runs the gardener now if it is on. Skips (ok with null) when no agent has a
   * usable primary account, so the week passes without a job (TRU-04).
   */
  async runNow(): Promise<Result<Job | null>> {
    if (!this.on || this.running) {
      return { ok: true, value: null };
    }
    this.running = true;
    try {
      const listed = await this.deps.accounts.list();
      if (!listed.ok) {
        return listed;
      }
      const accounts: readonly Account[] = listed.value;
      const choice = chooseGardenerAccount(accounts, (agent) => this.deps.levels.levelOf(agent) ?? START_LEVEL);
      if (choice === null) {
        return { ok: true, value: null };
      }

      const parsed = JobSpec.safeParse({
        mode: 'single',
        goal: this.deps.goal,
        repoPath: this.deps.repoPath,
        orchestrator: { agent: choice.agent, account: choice.accountId },
        workers: [choice.agent],
      });
      if (!parsed.success) {
        return { ok: false, error: gardenerError('The gardener job could not be created.', 'Check the gardener goal and repo path in the orch settings.') };
      }
      return await this.deps.jobs.start(parsed.data);
    } finally {
      this.running = false;
      this.arm();
    }
  }

  private nextRun(): Date {
    return nextGardenerRun(this.deps.clock(), this.deps.timeZone());
  }

  private arm(): void {
    this.disarm();
    if (!this.on) {
      return;
    }
    const due = this.nextRun();
    this.dueAt = due.getTime();
    const delay = Math.max(0, due.getTime() - this.deps.clock().getTime());
    this.timer = this.timers.set(() => {
      this.timer = null;
      // A timer can fire early after a sleep or a clock change: only run when due.
      if (this.deps.clock().getTime() >= this.dueAt) {
        void this.runNow();
      } else {
        this.arm();
      }
    }, delay);
  }

  private disarm(): void {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
  }
}
