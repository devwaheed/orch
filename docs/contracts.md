# Contracts

`packages/contracts` defines every shape that crosses a package or process boundary. It is **protected**: agents read it and build against it, but don't change it.

## What's in it

| File | Defines |
| --- | --- |
| `ids.ts` | Agent, OS, account, job, run, session, worktree and shell ids |
| `errors.ts` | `OrchError` (user-facing message + fix) and `Result<T>` |
| `config.ts` | The `accounts.yaml` schema, with defaults and validation |
| `accounts.ts` | Accounts, agent info, per-OS support, add and sign-in results |
| `quota.ts` | Usage windows, raw observations, account picking, spend |
| `jobs.ts` | Job modes, checks and guardrails, job specs, runs, run output lines |
| `sessions.ts` | Sessions, resume requests and options |
| `review.ts` | Verdicts, check results, worktree review, correction layers |
| `trust.ts` | Trust levels, thresholds, track records, summary |
| `doctor.ts` | Doctor checks and report |
| `adapter.ts` | The `AgentAdapter` interface every agent implements |
| `engine.ts` | Messages between the core host and the engine host, and the env allowlist |
| `specs.ts` | Spec files, queue settings and locked defaults, spec states, queue, load problems |
| `events.ts` | Live `OrchEvent`s for every client |
| `services.ts` | Every service interface the window, CLI and MCP can call |

## The engine contract table

These are the Claw capabilities orch depends on. Each has a contract test that runs on every Claw upgrade (story S1-11).

| Engine request | Claw capability |
| --- | --- |
| `health.ping` | Engine is loaded and responsive |
| `session.start` / `send` / `stop` | Persistent sessions for all five agents, with per-session `env` |
| `session.resume` | Continue a session with full history |
| `session.handoff` | Replay a session onto another engine in the same workspace |
| `workflow.start` / `status` / `resume` / `cancel` | solve, compare, council and autoloop workflows; checkpointed |
| `verify.run` | Acceptance contracts run by the engine, not the agent |
| `ledger.query` | Per-turn tokens, cost, `ok` and `verified` |

## Changing a contract

1. Write a short proposal: the change, why, and which packages it affects.
2. A person approves it.
3. Change the schema and its tests in one commit, then update every implementation in follow-up stories.

Adding an optional field is cheap; renaming or removing one touches every process, so prefer adding.
