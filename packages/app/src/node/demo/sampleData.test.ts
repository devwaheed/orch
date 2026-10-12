import { describe, expect, it } from 'vitest';
import {
  Account,
  AccountsFile,
  AgentInfo,
  DoctorReport,
  Job,
  QuotaWindow,
  Run,
  RunLine,
  Session,
  SpecQueue,
  TrustSummary,
  WorktreeReview,
} from '@orchagents/contracts';
import {
  DEMO_ACCOUNTS,
  DEMO_ACCOUNTS_FILE,
  DEMO_AGENTS,
  DEMO_JOBS,
  DEMO_QUOTA_WINDOWS,
  DEMO_REVIEWS,
  DEMO_RUNS,
  DEMO_RUN_LINES,
  DEMO_SESSIONS,
  DEMO_SPEC_QUEUE,
  DEMO_TRUST_SUMMARY_30,
  DEMO_TRUST_SUMMARY_7,
  createDemoDoctorReport,
} from './sampleData.js';

describe('Demo sample data contract schema validation', () => {
  it('keeps prototype run output timestamps at their local wall-clock times', () => {
    const callbackLine = DEMO_RUN_LINES['r-02']?.[0];
    const pausedLine = DEMO_RUN_LINES['r-04']?.[6];
    expect(callbackLine && new Date(callbackLine.at).toLocaleTimeString('en-GB', { hour12: false })).toBe('12:41:02');
    expect(pausedLine && new Date(pausedLine.at).toLocaleTimeString('en-GB', { hour12: false })).toBe('12:46:12');
  });

  it('validates every Account object in DEMO_ACCOUNTS against Account schema', () => {
    expect(DEMO_ACCOUNTS.length).toBeGreaterThan(0);
    for (const account of DEMO_ACCOUNTS) {
      const parsed = Account.safeParse(account);
      expect(parsed.success, `Account ${account.id} failed validation: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('validates every AgentInfo object in DEMO_AGENTS against AgentInfo schema', () => {
    expect(DEMO_AGENTS.length).toBe(5);
    for (const agent of DEMO_AGENTS) {
      const parsed = AgentInfo.safeParse(agent);
      expect(parsed.success, `Agent ${agent.id} failed validation: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('validates every QuotaWindow object in DEMO_QUOTA_WINDOWS against QuotaWindow schema', () => {
    expect(DEMO_QUOTA_WINDOWS.length).toBeGreaterThan(0);
    for (const window of DEMO_QUOTA_WINDOWS) {
      const parsed = QuotaWindow.safeParse(window);
      expect(parsed.success, `QuotaWindow ${window.accountId}:${window.window} failed validation: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('validates every Job object in DEMO_JOBS against Job schema', () => {
    expect(DEMO_JOBS.length).toBe(3);
    for (const job of DEMO_JOBS) {
      const parsed = Job.safeParse(job);
      expect(parsed.success, `Job ${job.id} failed validation: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('validates every Run object in DEMO_RUNS against Run schema', () => {
    expect(DEMO_RUNS.length).toBe(6);
    for (const run of DEMO_RUNS) {
      const parsed = Run.safeParse(run);
      expect(parsed.success, `Run ${run.id} failed validation: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('validates every RunLine object in DEMO_RUN_LINES against RunLine schema', () => {
    let totalLines = 0;
    for (const [runId, lines] of Object.entries(DEMO_RUN_LINES)) {
      expect(lines.length).toBeGreaterThan(0);
      totalLines += lines.length;
      for (const line of lines) {
        const parsed = RunLine.safeParse(line);
        expect(parsed.success, `RunLine ${runId}:${line.seq} failed validation: ${parsed.error?.message}`).toBe(true);
      }
    }
    expect(totalLines).toBeGreaterThan(20);
  });

  it('validates every Session object in DEMO_SESSIONS against Session schema', () => {
    expect(DEMO_SESSIONS.length).toBeGreaterThanOrEqual(7);
    for (const session of DEMO_SESSIONS) {
      const parsed = Session.safeParse(session);
      expect(parsed.success, `Session ${session.id} failed validation: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('validates every WorktreeReview object in DEMO_REVIEWS against WorktreeReview schema', () => {
    expect(DEMO_REVIEWS.length).toBe(4);
    for (const review of DEMO_REVIEWS) {
      const parsed = WorktreeReview.safeParse(review);
      expect(parsed.success, `Review ${review.worktree} failed validation: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('validates DEMO_TRUST_SUMMARY_7 and DEMO_TRUST_SUMMARY_30 against TrustSummary schema', () => {
    const parsed7 = TrustSummary.safeParse(DEMO_TRUST_SUMMARY_7);
    expect(parsed7.success, `TrustSummary 7 failed: ${parsed7.error?.message}`).toBe(true);

    const parsed30 = TrustSummary.safeParse(DEMO_TRUST_SUMMARY_30);
    expect(parsed30.success, `TrustSummary 30 failed: ${parsed30.error?.message}`).toBe(true);
  });

  it('validates DEMO_SPEC_QUEUE against SpecQueue schema', () => {
    const parsed = SpecQueue.safeParse(DEMO_SPEC_QUEUE);
    expect(parsed.success, `SpecQueue failed: ${parsed.error?.message}`).toBe(true);
    expect(DEMO_SPEC_QUEUE.specs.length).toBe(9);
  });

  it('validates createDemoDoctorReport against DoctorReport schema', () => {
    for (const os of ['macos', 'linux', 'windows'] as const) {
      const report = createDemoDoctorReport(os);
      const parsed = DoctorReport.safeParse(report);
      expect(parsed.success, `DoctorReport for ${os} failed: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('validates DEMO_ACCOUNTS_FILE against AccountsFile schema', () => {
    const parsed = AccountsFile.safeParse(DEMO_ACCOUNTS_FILE);
    expect(parsed.success, `AccountsFile failed: ${parsed.error?.message}`).toBe(true);
  });
});
