# Phase 1 · Engine and accounts (weeks 2–4)

**Goal:** a job runs end to end from the CLI on a chosen account, with no UI yet.

**Gate:** `orch run "fix the failing test" --check "npm test"` runs on a second Claude account, Claw verifies it, and `orch ps` shows it; `orch doctor` passes on macOS, Linux and Windows; CI green on all three.

**Order:** S1-01 and S1-02 first (by a person or one supervised agent). Then stories can run in parallel only where their **Owns** folders don't overlap. Each story lists the contracts it uses; if a story needs a contract change, stop and propose it.

Story format: **Owns** = the only folders you may change (plus their tests). **Uses** = contracts to build against. **Checks** = what must pass.

---

### S1-01 · Repository foundation

- **Owns:** repo root, `tools/`, `.github/`, package skeletons.
- **Do:** pnpm workspace with `base`, `contracts`, `platform`, `workbench`, `app`, `cli`, `mcp`; one tsconfig per environment (`common` has no DOM or Node types); ESLint with `tools/eslint.architecture.mjs` and `design/lint`; stylelint; dependency-cruiser with `tools/depcruise.cjs`; Vitest; Playwright; Changesets; Renovate with a 14-day minimum release age; CI on macOS, Linux and Windows running typecheck, lint, test.
- **Checks:** CI green on all three OSes with the empty packages; a deliberately bad import in a scratch branch fails `pnpm lint`.
- **Human gate:** yes. After this, `tools/` and lint configs are protected.

### S1-02 · base: events, results, services

- **Owns:** `packages/base`.
- **Do:** `Emitter`/`Event`, `Disposable`/`DisposableStore`, `ok()`/`err()` helpers for `Result`, `createServiceId<T>()`, and a `ServiceCollection` with explicit dependency lists, singleton lifetime and cycle detection.
- **Checks:** unit tests for disposal order, event delivery, cycle detection error message.

### S1-03 · Channels

- **Owns:** `packages/platform/src/channels`.
- **Uses:** `services.ts`, `events.ts`, `errors.ts`.
- **Do:** a generic proxy that exposes any service interface in-process, over MessagePort and as JSON-RPC over a local socket (Unix socket / Windows named pipe, owner-only permissions, random token); zod validation on both ends; event subscription; cancellation on disconnect.
- **Checks:** the same test suite runs against all three transports with a fake service; invalid payloads return `validation_failed`; a killed peer unsubscribes cleanly.

### S1-04 · Store

- **Owns:** `packages/platform/src/store`.
- **Do:** SQLite (better-sqlite3) with WAL, Drizzle schema and migrations for `account`, `quota_window`, `job`, `run_link`, `review`, `correction`, `trust_level`; integrity check at start; rolling backups (last 5).
- **Checks:** migrate up from empty and from the previous version; corrupt-file test falls back to the latest backup with a clear error.

### S1-05 · Config service

- **Owns:** `packages/platform/src/config`.
- **Uses:** `config.ts`, `IAccountsService.getConfig/setConfig`.
- **Do:** read, validate and write `~/.orch/accounts.yaml`; keep comments and order when the app changes a value; watch the file and emit `config.changed`; return field-level errors for bad YAML.
- **Checks:** round-trip tests (app edit → file → app); every example in the user guide parses; invalid files keep the last good config and report the line.

### S1-06 · Profiles service

- **Owns:** `packages/platform/src/profiles`.
- **Uses:** `adapter.ts`, `engine.ts` (`EngineEnv`).
- **Do:** create and remove profile folders; call `adapter.prepareProfile`; link the agent's shared skills folder (symlink on macOS/Linux, junction on Windows) when `share_skills` is on; build each session's `EngineEnv` from the adapter, filtered by `ENGINE_ENV_ALLOWLIST`; refuse any path that resolves outside `~/.orch/profiles/`.
- **Checks:** tests on all three OSes; path-escape attempts rejected; env never contains keys outside the allowlist.

### S1-07 · Claude Code adapter

- **Owns:** `packages/platform/src/adapters/node/claude.ts`.
- **Uses:** `AgentAdapter`, fixtures from S0-06.
- **Do:** implement every member from the spike's findings; parse rate-limit events into `QuotaObservation`.
- **Checks:** fixture tests for login, who-am-I, normal output, limit event, crash; `supportByOs` matches the spike report.

### S1-08 · Codex adapter

- **Owns:** `packages/platform/src/adapters/node/codex.ts`.
- **Do:** as S1-07; `prepareProfile` writes `cli_auth_credentials_store = "file"`.
- **Checks:** as S1-07, plus a test that `prepareProfile` is idempotent.

### S1-09 · Gemini CLI, OpenCode and Antigravity adapters

- **Owns:** `packages/platform/src/adapters/node/{gemini,opencode,agy}.ts`.
- **Do:** as S1-07, using the spike's support values; OpenCode reports its provider logins; Antigravity is marked experimental and uses the spike's headless workaround.
- **Checks:** fixture tests per adapter.

### S1-10 · Fake agent

- **Owns:** `packages/platform/test/fake-agent/`, `packages/platform/src/adapters/node/fake.ts` (test-only).
- **Do:** a small CLI that imitates an agent from a script: succeed, edit files, fail tests, hang, crash, report a limit with a reset time, report its account from its env.
- **Checks:** used by S1-11 to S1-17 instead of real agents.

### S1-11 · Engine host and client

- **Owns:** `packages/platform/src/engine`, `packages/app/src/electron-utility/engineHost.ts`, `packages/app/src/node/engineHost.ts`.
- **Uses:** `engine.ts`.
- **Do:** run Claw (pinned, data under `~/.orch/engine/`) in its host; implement every `EngineRequest`; validate every message; ping, restart with backoff, resume workflows after restart; emit `engine.health`.
- **Checks:** a contract test per operation against the pinned Claw using the fake agent; kill-the-host test resumes a running workflow; requests with non-allowlisted env are rejected before reaching Claw.

### S1-12 · Quota service

- **Owns:** `packages/platform/src/quota`.
- **Uses:** `quota.ts`, `IQuotaService`.
- **Do:** turn observations into windows; `pickAccount` with both routing rules, `use: false`, signed-out and limited accounts, `max_runs_per_account`, `near_limit_at`; emit `quota.limited`/`quota.available`.
- **Checks:** table-driven tests covering every rule in the user guide's "Primary and backup" section.

### S1-13 · Git, jobs and runs (single mode)

- **Owns:** `packages/platform/src/{git,jobs,runs}`.
- **Uses:** `jobs.ts`, `IJobsService`, `IRunsService`.
- **Do:** create a worktree per writing run; start a single-mode job through an engine workflow on the account the quota service picks; stream run lines; run the job's checks and the two guardrails through the engine; pause on limit per `onLimit`.
- **Checks:** with the fake agent: success, refuted (check fails), limit mid-run then resume on another account, crash then resume; guardrail fails when a test file is edited.

### S1-14 · Doctor

- **Owns:** `packages/platform/src/doctor`.
- **Uses:** `doctor.ts`.
- **Do:** agent installed and version in tested range; git supports worktrees; engine ping; per agent, two throwaway profiles report different accounts (when the user opts in to signing in twice); shared skills visible in each profile; disk space.
- **Checks:** every check has a pass, warn and fail test with a `fix` message.

### S1-15 · Core host

- **Owns:** `packages/app/src/node/coreHost.ts`, `packages/app/src/electron-utility/coreHost.ts`.
- **Do:** register all services, start the local socket, forward events; same code in both entries.
- **Checks:** headless start-up test; the socket refuses a wrong token.

### S1-16 · CLI

- **Owns:** `packages/cli`.
- **Uses:** the channel client only.
- **Do:** `orch accounts`, `orch accounts add <agent> "<name>"`, `orch doctor`, `orch run` (single mode, `--check`, `--orchestrator`, `--on-limit`), `orch ps`, `orch limits`. Output matches the CLI artboard in `design/prototype/Terminal.dc.html`.
- **Checks:** snapshot tests of command output against the artboard text; exit codes documented.

### S1-17 · Walking skeleton

- **Owns:** `packages/app/test/e2e/skeleton.test.ts`.
- **Do:** end-to-end: add a second fake Claude account, run `orch run "fix the failing test" --check "npm test"`, assert it ran on that account, the verdict is verified, and `orch ps` shows it.
- **Checks:** runs in CI on all three OSes with the fake agent; runs nightly with real Claude Code on a test account.
- **Human gate:** the phase 1 gate.
