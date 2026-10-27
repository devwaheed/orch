# How orch fits together

orch is a desktop app and command-line tool that coordinates coding agents across isolated accounts, verifies their work in dedicated git worktrees, and lets you review every change before merging.

[[diagram:overview]]

## The pieces

orch isolates heavy work across dedicated processes to keep the user interface fast and isolate crashes:

- **Window**: the desktop interface built in React. It renders screens, streams run output, and connects directly to the core host through a typed bridge (`window.orch`) over a MessagePort. UI traffic never passes through Electron's main process.
- **Core host**: runs all orch services, including accounts, quota routing, jobs, runs, sessions, review, trust, doctor, and the SQLite database (`~/.orch/orch.db`). It also serves a local JSON-RPC socket for the `orch` CLI and `orch-mcp`.
- **Engine host**: runs Claw Orchestrator as a library. It executes agent workflows and starts agent CLI processes.
- **PTY host**: manages native pseudo-terminals (`node-pty`) for interactive shells in the terminal dock. Shell processes are isolated so that a crashing shell cannot bring down the app or engine.
- **Agent CLIs**: the supported coding agents (Claude Code, Codex, Gemini CLI, OpenCode, and Antigravity). Each account runs in its own environment with a separate profile folder under `~/.orch/profiles/`, keeping credentials and sessions completely separated.
- **CLI and MCP**: the `orch` command-line tool and the `orch-mcp` server talk to the core host over a local domain socket (or named pipe on Windows).

## How a job flows

Every job you start follows a structured lifecycle from assignment to merge.

[[diagram:job-flow]]

1. **Start**: you specify a title and goal, choose a mode ([new-spec.md](new-spec.md)), and set automated done-when checks. orch selects an available account based on capacity and routing rules.
2. **Worktree creation**: orch creates an isolated git worktree at `.orch/wt/<run-id>/` on a new branch named `orch/<run-id>` (or `orch/spec-<id>` for specs). Read-only roles such as planners, reviewers, and auditors run directly in the main checkout without write access.
3. **Run**: the engine host starts the agent CLI within that run's isolated profile environment. The agent reads the goal and makes code changes inside its worktree.
4. **Automated verification**: when the agent declares it is finished, orch runs your done-when checks alongside two permanent guardrails. Agents cannot modify or skip these checks.
5. **Review**: runs with passing checks receive a **Verified** verdict and appear in the Review screen ([review.md](review.md)).
6. **Merge**: when you approve the run, orch rebases the worktree onto `main`, re-runs all checks and guardrails against the rebased tree, and squashes the changes into a single commit.

## Good to know

- orch never reads, stores, or copies agent credentials. Sign-in runs directly inside the agent's native login flow.
- orch writes `.orch/` to `.git/info/exclude`. It never modifies your repository's `.gitignore` file.
- All application data, logs, database state, and account profiles live under `~/.orch/` (or `%USERPROFILE%\.orch` on Windows).

> You can run orch headless on a remote server with `orch serve`. In headless mode, the core host, engine host, and PTY host run as standard Node child processes without an Electron window.
