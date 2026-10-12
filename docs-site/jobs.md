# Jobs

A job is one goal you start. A run is one agent working on part of a job. In **New job**, enter a goal and choose how agents should work on it.

## The four modes

- **One job, split up**: an orchestrator plans the work and hands parts to other agents.
- **Compare agents**: several agents answer the same question; you see the answers side by side. There can be 2–5 agents. An optional combine step writes one recommendation listing disagreements.
- **Council**: 2–5 members work in their own worktrees and discuss until they agree. Choose 3, 5, or 8 rounds; the default is 5.
- **Autoloop**: a Planner, Coder, and Reviewer iterate. You approve the plan before coding starts.

## Checks and guardrails

Checks are commands orch runs after agents say they are finished. Agents cannot change these checks. A run is not **verified** unless checks and guardrails pass.

Two guardrails are always on:

- **No new lint or type suppressions**: the diff cannot add known lint or type suppression directives.
- **Lint config, tests and CI files stay unchanged**: protected configuration, CI, and existing test files cannot be modified or deleted (with the spec-queue scope exception).

Each command check has a default timeout of 10 minutes. A timeout is a failed check.

## If an account hits its limit

Choose **Switch account**, **Switch agent**, or **Ask me**. The default policy is Switch account. A run that hits a limit pauses while keeping its worktree and session; orch then follows the selected policy. See [Limits](limits.md).

<!-- Source: LOCKED JOB-02, JOB-04, JOB-05, JOB-06, JOB-08, JOB-09, QTA-03; design/screens.md: Start a job -->
