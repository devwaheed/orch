# Command line and MCP

The `orch` command line and the `orch-mcp` server let you control jobs, inspect quota, manage the spec queue, and interact with orch services from scripts or agent workflows.

## CLI commands

The `orch` command connects to the local orch core host over a local socket. Add `--json` to commands where supported to output structured contract objects.

### System and core commands

- `orch`: opens the desktop app, or focuses it if already running.
  - `orch <path>` opens that repository (resolving to its git root).
  - In non-interactive environments or when `CI` is set, prints help and exits 0.
  - On headless systems without a display, prints a status summary if `orch serve` is running.
- `orch --version`: prints the installed versions of orch and the engine (`orch <version> · engine <engine version>`).
- `orch serve`: starts the headless background services (core host, engine host, and PTY host) on servers without a display.
- `orch doctor`: checks system health, installed agents, engine status, and account profiles.
  - `--sign-in-twice`: also runs account isolation checks by signing in twice per agent.
- `orch bug-report`: bundles doctor checks, versions, masked account configurations, spec queue configuration (if present), and the last 3 days of logs into a zip file on your computer.
  - `--out <folder>`: specifies the output directory.
- `orch uninstall`: prompts for confirmation and removes `~/.orch/` (or `%USERPROFILE%\.orch`).
  - `--yes`: skips confirmation.

### Accounts and capacity

- `orch accounts`: lists all configured agent accounts, primary statuses, and availability.
- `orch accounts add <agent> <name>`: creates an isolated profile and runs the agent's sign-in flow.
  - `--type <type>`: records the account type.
- `orch limits`: displays live capacity and quota windows for all accounts.

### Jobs, runs, and sessions

- `orch run "<goal>"`: starts a single-mode job with a goal and automated verification checks.
  - `--check <cmd>`: shell command that orch runs to verify completion (can be specified multiple times).
  - `--web-check <url>`: HTTP(S) address orch checks for a successful response (can be specified multiple times).
  - `--allow <glob>`: file pattern allowed to change (can be specified multiple times).
  - `--orchestrator <choice>`: agent or account to orchestrate the job (e.g. `claude` or `claude@work`).
  - `--on-limit <policy>`: policy when an account hits its limit (`switch-account`, `switch-agent`, or `ask`).
  - `--workers <agents>`: allowed worker agents.
- `orch ps`: lists all active agent runs and tasks.
- `orch attach <run>`: streams the live output of a run in your terminal. Press `Ctrl-]` to detach; the run continues executing in the background.
- `orch move <run> --to <agent@account>`: immediately moves an active run to another specified account.
- `orch sessions`: lists conversation sessions.
  - `--resumable`: filters to resumable sessions only.
- `orch resume <session>`: resumes a session.
  - `--to <agent@account>`: hands off to another account or agent.
  - `--fork`: forks the session into a new git branch and worktree.

### Spec queue commands

Manage the spec queue ([specs.md](specs.md)) directly from the command line. All spec commands accept `--repo <path>`.

- `orch specs`: prints the spec queue table showing IDs, titles, status pills, and dependencies.
- `orch specs init`: scans stories and adds front-matter skeletons to BMAD stories that lack them.
- `orch specs check`: validates all spec files in the source folder and prints any syntax or schema problems.
- `orch specs start`: starts the spec queue scheduler.
- `orch specs pause`: pauses the queue. Active specs finish; no new specs start.
- `orch specs resume`: resumes scheduling a paused queue.
- `orch specs cancel`: stops all active spec runs and cancels the queue.
- `orch specs retry <id>`: resets the attempt counter and retries a failed or stopped spec.
- `orch specs skip <id>`: marks a spec as skipped and moves to the next spec.
- `orch specs move <id> <position>`: moves a queued spec to a new numeric position in the queue.

## MCP server

The `orch-mcp` executable exposes core orch services to agents using the Model Context Protocol (MCP) over standard input/output (`stdio`).

It provides two tools:

- `start_job`: starts an orch job from a structured job specification (`JobSpec`).
- `get_limits`: returns live usage windows for all accounts, including the next recommended account for an agent.

## Good to know

- The CLI uses standard exit codes:
  - `0`: success.
  - `1`: problem found (e.g. doctor issues or spec check errors).
  - `2`: invalid usage.
  - `3`: engine or background service unavailable.
- Commands that output tables match the styling of the app's terminal dock. Use `--json` to pipe raw contract data into `jq` or scripts.
