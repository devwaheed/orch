# Command line and MCP

The desktop app includes the `orch` command. The implemented command handlers are listed below. The CLI connects to the local orch core host. Use `--json` for contract objects where supported.

## CLI commands

- `orch accounts` lists accounts.
- `orch accounts add <agent> <name>` adds an account and verifies sign-in.
- `orch doctor` checks the system, agents, engine, and profiles. `--sign-in-twice` also runs isolation checks.
- `orch run "<goal>"` starts a single-mode job. Options include `--check`, `--orchestrator`, `--on-limit`, and `--workers`.
- `orch ps` lists runs.
- `orch limits` shows account usage windows.
- `orch sessions [--resumable]` lists sessions.
- `orch resume <session> [--to <agent@account>] [--fork]` resumes, hands off, or forks a session.
- `orch specs` lists the queue. Subcommands: `init`, `check`, `start`, `pause`, `resume`, `cancel`, `skip <id>`, `retry <id>`, and `move <id> <position>`. Spec commands accept `--repo <path>`.
- `orch uninstall` removes orch data after confirmation. `--yes` skips the confirmation.

`orch serve`, `orch attach`, and `orch move` are listed in the locked v1 command set, but do not currently have command handlers in `packages/cli/src`. <!-- TBD: These command handlers are not implemented yet. -->

## orch-mcp tools

The `orch-mcp` server exposes these tools over stdio:

- `start_job`: start a job from a job spec.
- `get_limits`: get usage windows for every account; pass an agent to include the account orch would use next.

<!-- Source: LOCKED CLI-01, CLI-02, CLI-03; packages/cli/src/node/cli.ts, packages/cli/src/node/specs/commands.ts; packages/mcp/src/node/server.ts -->
