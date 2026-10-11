# Phase 3 · Review and recovery (weeks 8–9)

**Goal:** limits never lose work, and only verified work can merge.
**Gate:** a limit mid-job pauses and resumes on another account with no lost work; only verified work merges; screens match baselines.

### S3-01 · Review screen
- **Owns:** `packages/workbench/src/browser/contrib/review/`, `packages/platform/src/review`.
- **Refs:** screens.md (Review); `IReviewService`; LOCKED REV-01…REV-05.
- **Do:** worktree list, verdict banner, checks row, file list, Monaco diff, approve & merge (REV-02), request changes, discard, evidence link.
- **Checks:** baselines; "only verified can merge"; merge commit message format; rebase-then-recheck path.

### S3-02 · Sessions screen and resume
- **Owns:** `packages/workbench/src/browser/contrib/sessions/`, `packages/platform/src/sessions`.
- **Refs:** screens.md (Sessions); `ISessionsService`, `ResumeOption`; LOCKED SES-01…SES-04.
- **Do:** filters, list, details with "Stopped at / Now at", the four resume options with availability rules, CLI line.
- **Checks:** baselines; each resume mode end to end with the fake agent.

### S3-03 · Paused by a limit
- **Owns:** `packages/platform/src/runs` (limit handling), `packages/workbench/src/browser/contrib/work/panes/paused/`.
- **Refs:** LOCKED QTA-03, QTA-04; screens.md (Work).
- **Do:** pause on limit, apply `onLimit`, "Resume now on {account}", auto-resume checkbox, auto-resume at reset with jitter.
- **Checks:** fake-agent limit mid-run → resume on another account keeps worktree; auto-resume fires.

### S3-04 · Capacity panel and quota learning
- **Owns:** `packages/workbench/src/browser/parts/capacity/`, `packages/platform/src/quota` (estimation).
- **Refs:** screens.md (Capacity panel); LOCKED QTA-01, QTA-02, QTA-05.
- **Do:** windows per account, reported vs estimated, "usage unknown", stale ages, spend today from the ledger.
- **Checks:** baseline; learning test: after one limit, estimates appear.

### S3-05 · Baselines for phase 3 (human only)
