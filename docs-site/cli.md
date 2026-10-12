# Command line and MCP

The desktop app includes the `orch` command (see [Getting started](getting-started.md#the-orch-command)). The CLI connects to the local orch core host. Use `--json` for contract objects where supported.

## CLI commands

- `orch` opens the app, or focuses it if it's running. `orch <path>` opens that repository. On a machine with no display, `orch` prints a short status when `orch serve` is running. When output isn't a terminal, or `CI` is set, it prints help.
- `orch --version` prints the orch and engine versions.
- `orch serve` runs orch without a window, for servers.
- `orch accounts` lists accounts.
- `orch accounts add <agent> <name>` adds an account and verifies sign-in.
- `orch doctor` checks the system, agents, engine, and profiles. `--sign-in-twice` also runs isolation checks.
- `orch run "<goal>"` starts a single-mode job. Options include `--check`, `--orchestrator`, `--on-limit`, and `--workers`.
- `orch ps` lists runs.
- `orch attach <run>` streams a live run. Type to send a message. Press Ctrl-] to detach; the run keeps running.
- `orch move <run> --to <agent@account>` moves a run to another account now.
- `orch limits` shows account usage windows.
- `orch sessions [--resumable]` lists sessions.
- `orch resume <session> [--to <agent@account>] [--fork]` resumes, hands off, or forks a session.
- `orch specs` lists the queue. Subcommands: `init`, `check`, `start`, `pause`, `resume`, `cancel`, `skip <id>`, `retry <id>`, and `move <id> <position>`. Spec commands accept `--repo <path>`.
- `orch bug-report [--out <folder>]` saves a bug-report zip and prints its path.
- `orch uninstall` removes orch data after confirmation. `--yes` skips the confirmation.

## orch-mcp tools

The `orch-mcp` server exposes these tools over stdio:

- `start_job`: start a job from a job spec.
- `get_limits`: get usage windows for every account; pass an agent to include the account orch would use next.

<!-- Source: LOCKED CLI-01…CLI-05, INS-03, BUG-01; packages/cli/src/node/cli.ts, packages/cli/src/node/specs/commands.ts; packages/mcp/src/node/server.ts -->
