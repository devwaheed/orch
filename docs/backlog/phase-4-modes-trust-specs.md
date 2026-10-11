# Phase 4 · Modes, trust and the spec queue (weeks 10–11)

**Goal:** all four job modes, corrections by layer, trust, and the spec queue running 64 specs unattended.
**Gate:** every acceptance scenario in `docs/specs/spec-queue.md` §15 passes; a refuted run produces a lint-rule follow-up job; Trust numbers match the ledger; signing accounts are approved (S4-12).

### S4-01 · Compare, Council and Autoloop modes
- **Owns:** `packages/workbench/src/browser/contrib/newjob/modes/`, `packages/platform/src/jobs` (modes).
- **Refs:** screens.md (Start a job); `JobSpec`; LOCKED JOB-08, JOB-09.
- **Checks:** baselines (incl. council); each mode end to end with the fake agent.

### S4-02 · Guardrails
- **Owns:** `packages/platform/src/review/guardrails/`.
- **Refs:** LOCKED JOB-05, JOB-06.
- **Do:** detect new suppressions and protected-file changes from the diff.
- **Checks:** one test per pattern and per protected path; adding a new test file passes; deleting one fails.

### S4-03 · Corrections by layer
- **Owns:** `packages/platform/src/review/corrections/`, `packages/workbench/src/browser/contrib/review/corrections/`.
- **Refs:** screens.md (Review); `CorrectionLayer`; LOCKED REV-06.
- **Checks:** each layer's follow-up; AGENTS.md lesson append after approval.

### S4-04 · Trust service and screen
- **Owns:** `packages/platform/src/trust`, `packages/workbench/src/browser/contrib/trust/`.
- **Refs:** screens.md (Trust); `ITrustService`; LOCKED TRU-01…TRU-03.
- **Checks:** baseline; numbers computed from fixture ledgers; promotion rules; level-3 auto-merge only within TRU-03.

### S4-05 · Gardener
- **Owns:** `packages/platform/src/trust/gardener/`.
- **Refs:** LOCKED TRU-04.
- **Checks:** schedule, account choice, proposals arrive as jobs.

### S4-06 · orch-mcp
- **Owns:** `packages/mcp`.
- **Refs:** `OrchServices`; ADR 0007.
- **Do:** expose start job, spawn worker, get limits, update plan as MCP tools through the channel client.
- **Checks:** an orchestrator agent (fake) spawns a worker through MCP.

### S4-07 · Spec loader and validation
- **Owns:** `packages/platform/src/specs/loader/`.
- **Refs:** spec-queue.md §2, §3, §11; `SpecFile`, `SpecQueueSettings`, `SpecLoadProblem`.
- **Do:** read spec files and `.orch/specs.yaml`; all load problems with exact messages; `orch specs init` for BMAD stories; sprint-status.yaml detection.
- **Checks:** SQ-20, SQ-21; one test per problem code; init output on a sample BMAD folder.

### S4-08 · Spec scheduler and state machine
- **Owns:** `packages/platform/src/specs/queue/`.
- **Refs:** spec-queue.md §4–§10; `SpecState`, `SpecRun`, `ISpecsService`.
- **Do:** transitions table enforced in one place; scheduler (§5) with overlap rule; tries, audits (different agent), gates; merge order; pause, cancel, restart recovery.
- **Checks:** SQ-01…SQ-19, SQ-22 as automated tests with the fake agent; a 64-spec synthetic queue completes unattended in CI.

### S4-09 · Specs screen and agent map
- **Owns:** `packages/workbench/src/browser/contrib/specs/`.
- **Refs:** spec-queue.md §12; design artboards "Work — Specs" and "agent map".
- **Checks:** baselines for queue and map; labels exactly as §12; rules controls write `.orch/specs.yaml`.

### S4-10 · Spec CLI
- **Owns:** `packages/cli/src/node/specs/`.
- **Refs:** spec-queue.md §13; LOCKED CLI-02, CLI-03.
- **Checks:** snapshot tests; exit codes.

### S4-11 · Baselines for phase 4 (human only)

### S4-12 · Signing accounts (human only)
- **Do:** Apple Developer Program membership and a Windows code-signing certificate; store secrets in CI.
