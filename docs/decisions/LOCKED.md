# Locked decisions

Every product and technical value agents need, decided in advance. **Implement these exactly.** If a task needs a value that is not here, not in `packages/contracts`, not in a spec under `docs/specs/` and not in `design/`, **don't choose one: stop and ask.**

- Values marked **[SPIKE]** are filled in after phase 0. Don't start a story that depends on one until it's filled.
- To change a locked value: write an ADR in `docs/adr/`, get it approved, then update this file. Never change it in passing.
- Each entry has an id (e.g. `ACC-03`). Reference ids in commits and code comments where they explain a rule.

## Product (PRD)

| Id | Decision |
| --- | --- |
| PRD-01 | Product name in the UI and commands: `orch` (lowercase). Working name until changed by ADR. |
| PRD-02 | Platforms at v1.0: macOS 13+ (Apple silicon and Intel), Windows 11 x64, Linux x64 (Ubuntu 22.04+ / Fedora 39+). All fully supported. |
| PRD-03 | Delivered only as desktop installers (REL-03) with the `orch` command included (INS-01…INS-05); `orch serve` runs headless. Nothing is published to npm (ADR 0002 amendment). |
| PRD-04 | Local only: no cloud service, no accounts with us, no telemetry. |
| PRD-05 | Supported agents at v1.0, exactly: Claude Code (`claude`), Codex (`codex`), Gemini CLI (`gemini`), OpenCode (`opencode`), Antigravity (`agy`, marked experimental). |
| PRD-06 | Areas of the app, in this order in the activity bar: Product (factory products only, docs/specs/product-pipeline.md), Specs, Review, Sessions · divider · Trust, Accounts; Settings at the bottom. No other areas. Specs is the default. Amended 2026-10-27 by owner decision: Work merged into Specs as its Live view (ADR 0013). Amended 2026-10-29 by owner decision: Product added above Specs. |
| PRD-07 | Out of scope for v1.0: team or cloud hosting, a skills library, remote workers, app-store listings, auto-merge in the spec queue, specs across several repos, editing files inside orch (open in editor only), lessons memory beyond correction layers. |

## Architecture (ARC)

| Id | Decision |
| --- | --- |
| ARC-01 | Code architecture as in `docs/architecture.md` (ADR 0005, 0006, 0007). |
| ARC-02 | Node.js 22 LTS; TypeScript with the strict settings in `packages/contracts/tsconfig.json`; pnpm workspaces. |
| ARC-03 | Packages: `base`, `contracts`, `platform`, `workbench`, `app`, `cli`, `mcp`, plus `design/`. No others without an ADR. |
| ARC-04 | Every dependency pinned to an exact version; Renovate with a 14-day minimum release age. |
| ARC-05 | Libraries (exact versions set in S1-01): Electron, electron-builder, electron-updater, React, Vite, Zustand, TanStack Query, cmdk, xterm.js, Monaco, node-pty, better-sqlite3, Drizzle, zod, yaml, execa, pino, commander, @clack/prompts, @modelcontextprotocol/sdk, Vitest, Playwright, ESLint, typescript-eslint, stylelint, dependency-cruiser, Changesets. Nothing else without approval. |
| ARC-06 | Styling: Tailwind 4 utility classes themed from `design/tokens/tokens.css` (generated `tailwind.css`, no default palette, no preflight). No hand-written CSS modules, CSS-in-JS or UI kits. Amended 2026-10-27 by owner decision (ADR 0012). |

## Engine (ENG)

| Id | Decision |
| --- | --- |
| ENG-01 | Engine: Claw Orchestrator (`@enderfga/claw-orchestrator`), version `7.5.6` with the per-session env patch (ADR 0011), pinned exactly; never newer than 14 days at adoption. |
| ENG-02 | Runs as a library inside the engine host process; if the spike finds gaps, its server runs on a private socket inside the same host (ADR 0001). |
| ENG-03 | Engine data folder: `~/.orch/engine/`. |
| ENG-04 | Never start Claw's dashboard, MCP server, ACP agent or OpenAI-compatible endpoint. |
| ENG-05 | Session env limited to `ENGINE_ENV_ALLOWLIST` in contracts. |
| ENG-06 | User-facing name for the engine in errors, logs and doctor: "engine". Claw is named only in Settings → About and the licences file. |
| ENG-07 | Engine host restart backoff: 1 s, 2 s, 5 s, 10 s, then every 30 s. After 5 failed restarts in 10 minutes, show a bar under the title bar: "The engine keeps stopping." with buttons "Restart engine" and "Report a problem". While restarting, the status-bar engine dot is amber with "engine restarting". |

## Accounts (ACC)

| Id | Decision |
| --- | --- |
| ACC-01 | Profile folders: `~/.orch/profiles/<agent>-<slug>/` (`%USERPROFILE%\.orch\profiles\…` on Windows). Slug: lowercase name, spaces to `-`, other characters removed; duplicates get `-2`, `-3`. |
| ACC-02 | Account settings per agent: Claude Code `CLAUDE_CONFIG_DIR`; Codex `CODEX_HOME` + `cli_auth_credentials_store = "file"` in the profile config; Gemini CLI `GEMINI_CLI_HOME`; OpenCode `XDG_DATA_HOME` + `OPENCODE_CONFIG_DIR=<profile>/config`; Antigravity separate home folder (`HOME`/`USERPROFILE`); agy ≥1.4 keeps its login in `~/.gemini/antigravity-cli/antigravity-oauth-token` inside that home (orch only checks the file exists, never reads it). See docs/spike/agy-multi-account.md. |
| ACC-03 | Several accounts per agent per OS: Claude, Codex, Gemini parallel on all three; OpenCode parallel on macOS/Linux, unverified on Windows; Antigravity parallel on macOS and Linux when its login lands in the account's own home folder (checked after each sign-in; if agy used the system keyring instead, that account fails "Kept separate" and only one Antigravity account works), single on Windows. **[SPIKE: confirm]**. Single = Add account disabled after the first; never swap logins. |
| ACC-04 | orch never reads, copies or stores credentials. Sign-in runs the agent's own login; who-am-I uses the agent's own status command **[SPIKE: per agent]**. Emails are shown masked: first character, `•••`, `@`, domain. |
| ACC-05 | Each agent with accounts has exactly one primary. The first account added becomes primary. Removing the primary makes the oldest remaining account primary. |
| ACC-06 | Routing: `primary-first` uses the primary until it is near its limit (≥ `near_limit_at`, default 85 %), then the backup with the lowest usage. `most-headroom` always picks the lowest usage. Ties: the older account. Accounts with `use: false`, signed out or limited are never picked. |
| ACC-07 | `max_runs_per_account` default 3: an account at that many active runs is skipped. |
| ACC-08 | Removing an account asks for confirmation, then deletes its profile folder only. Never touches the agent's normal folders (`~/.claude`, `~/.codex`, …). |
| ACC-09 | Shared skills default on; link type: symlink on macOS/Linux, directory junction on Windows. A link is created only if the target exists. |
| ACC-10 | OpenCode: show its provider logins and the Claude Pro/Max warning; orch does not block any login. |

## Quota and limits (QTA)

| Id | Decision |
| --- | --- |
| QTA-01 | Usage comes only from agent output and errors parsed by adapters. orch never calls provider APIs or reads provider websites. |
| QTA-02 | "Reported" windows come from the agent. For agents that report nothing, a window is "estimated" only after orch has seen one limit: it learns the number of requests at that limit and estimates usage as requests since reset ÷ learned number. Before that, the UI shows "usage unknown" (no bar). |
| QTA-03 | When a limit hits mid-run: pause the run (`paused_limit`), keep worktree and session, then apply the job's `onLimit` policy. |
| QTA-04 | Auto-resume at the reset time plus a random 0–120 s delay. |
| QTA-05 | Quota windows older than 6 hours are shown with their age ("seen 7 h ago") and treated as stale for routing (stale = assume 0 % used). |

## Jobs, runs and checks (JOB)

| Id | Decision |
| --- | --- |
| JOB-01 | Ids: jobs `j-<n>`, runs `r-<n>`, sessions `s-<4 hex>`, base-36 counters per orch install. |
| JOB-02 | Worktrees: `<repo>/.orch/wt/<run-id>/`, branch `orch/<run-id>` (spec queue: `orch/spec-<id>`). orch adds `.orch/` to `.git/info/exclude`; it never edits `.gitignore`. |
| JOB-03 | Read-only runs (reviewer, auditor, orchestrator) run in the main checkout without write access; they get no worktree. |
| JOB-04 | Default check timeout 10 minutes per command; a timeout is a failed check. |
| JOB-05 | Guardrail "no new suppressions": fails if the diff adds any of: `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `stylelint-disable`, `# type: ignore`, `# noqa`, `//nolint`, `#[allow(`, `@SuppressWarnings`. |
| JOB-06 | Guardrail "protected files": fails if the diff modifies or deletes `.eslintrc*`, `eslint.config.*`, `biome.json*`, `.stylelintrc*`, `stylelint.config.*`, `tsconfig*.json`, `.github/workflows/**`, `**/__snapshots__/**`, `**/__screenshots__/**`, `sprint-status.yaml`, or modifies/deletes existing test files (`**/*.test.*`, `**/*.spec.*`, `test/**`, `tests/**`). Adding new test files is allowed. Existing test files inside a spec's `scope` may be modified but not deleted. |
| JOB-07 | Messages typed to a running agent are delivered as its next turn. Pause = finish the current turn, then hold. Stop = end the session now; the worktree is kept. |
| JOB-08 | Job modes and their Claw templates: single → `solve`, compare → `fanout` plus orch's combine step (ADR 0011), council → `council`, autoloop → `autoloop`. Default `onLimit`: `switch-account`. |
| JOB-09 | Compare: 2–5 agents; "combine" uses the orchestrator default agent (first in ACC order with room) to write one recommendation listing disagreements. Council: 2–5 members, rounds 3/5/8, default 5. Autoloop roles: Planner, Coder, Reviewer; the plan needs your approval before coding starts. |

## Review and merge (REV)

| Id | Decision |
| --- | --- |
| REV-01 | Approve & merge is possible only when the verdict is `verified`. |
| REV-02 | Merge method: rebase the worktree onto `main`, re-run checks and guardrails, then squash into one commit: `{title}` + blank line + `orch: job {job}, run {run}, verified {YYYY-MM-DD}`. |
| REV-03 | Target branch: the repo's current default branch at job start. |
| REV-04 | Discard asks for confirmation, then deletes the worktree and branch. |
| REV-05 | Request changes sends your text to the run's session as its next turn and starts a new try. |
| REV-06 | Corrections: Codebase and Lint start a single-mode job with goal "{action}" and the original checks; Agent rule shows the line for your approval, then appends it under `## Lessons` in the repo's `AGENTS.md` (creating the heading if missing); Review note is stored in orch and shown in Review. |

## Sessions (SES)

| Id | Decision |
| --- | --- |
| SES-01 | Continue this session: same account only; waits for reset if limited. |
| SES-02 | Hand off (account or agent): uses Claw's session handoff into the same worktree; the old session becomes `ended` with "Handed off to {id}". |
| SES-03 | Fork: new branch `orch/<run-id>-fork-<n>` from the current worktree state; new session. |
| SES-04 | Sessions are kept 90 days after they end, then deleted with their transcripts (worktrees are not deleted automatically). |

## Trust (TRU)

| Id | Decision |
| --- | --- |
| TRU-01 | First-try verified = verified on attempt 1 with no "request changes". Measured over the last 30 days, minimum 20 runs; below 20 the agent shows "Not enough runs yet" and can't be promoted. |
| TRU-02 | Thresholds: level 2 at 70 %, level 3 at 85 % (`TRUST_THRESHOLDS`). New agents start at level 1. Promotion is manual only. An agent that drops 10 points below its level's threshold is shown "Below threshold" (not demoted automatically). |
| TRU-03 | Level 3 auto-merges single-mode jobs only, when every changed file matches `**/*.md`, `docs/**`, `test/**`, `tests/**`, `**/*.test.*`, `**/*.spec.*`, and the diff is under 200 changed lines. Never in the spec queue. |
| TRU-04 | Gardener: on by default, Mondays 09:00 local time, on the primary account of the highest-level agent (ties: ACC order). Its proposals arrive as a normal job in Review. |

## Spec queue (SQ)

| Id | Decision |
| --- | --- |
| SQ-ALL | Everything in `docs/specs/spec-queue.md` is locked: file format, settings and defaults, states and transitions, scheduler, tries, audits, merge order, UI labels, CLI, acceptance scenarios. |

## UI (UI)

| Id | Decision |
| --- | --- |
| UI-01 | Everything in `design/DESIGN_RULES.md` and `design/screens.md`. |
| UI-02 | Theme: follows the system until the user picks one; the choice is remembered. |
| UI-03 | Fonts IBM Plex Sans and IBM Plex Mono, bundled with the app (no network font loading). |
| UI-04 | Window: minimum 1100 × 700; remembers size and position per display. |
| UI-05 | Shortcuts (⌘ on macOS, Ctrl elsewhere): ⌘K command palette, ⌘N new spec, ⌘1 Specs, ⌘2 Review, ⌘3 Sessions, ⌘4 Trust, ⌘5 Accounts, ⌘B capacity panel, ⌃` terminal, ⌘\ split editor, ⌘W close tab. Amended 2026-10-27 (ADR 0013). |
| UI-06 | Native notifications only while the window is not focused, for: an account available again, a spec needs you, a job verified, the engine keeps stopping. |
| UI-07 | Language: English only at v1.0; all user-facing strings live in one file per area so translation can be added later. |

## Security and files (SEC)

| Id | Decision |
| --- | --- |
| SEC-01 | Local socket: `~/.orch/orch.sock` (owner-only) on macOS/Linux; named pipe `\\.\pipe\orch-<username>` on Windows. Token in `~/.orch/token`, owner-only, regenerated each start. |
| SEC-02 | Electron windows: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, only bundled pages, no remote content, external links open in the system browser. |
| SEC-03 | Logs: `~/.orch/logs/`, 10 MB × 5 files, kept 14 days, redacted (tokens, keys, emails, env values). |
| SEC-04 | Database: `~/.orch/orch.db`, WAL, 5 rolling backups in `~/.orch/backups/`. |
| SEC-05 | `orch uninstall` removes `~/.orch/` after confirmation; never touches repos, worktrees outside `~/.orch/`, or the agents' own folders. |

## CLI (CLI)

| Id | Decision |
| --- | --- |
| CLI-01 | Commands at v1.0, exactly: `orch`, `orch <path>`, `orch --version`, `orch serve`, `orch doctor`, `orch accounts`, `orch accounts add <agent> "<name>"`, `orch run "<goal>"`, `orch ps`, `orch attach <run>`, `orch sessions [--resumable]`, `orch resume <session> [--to <agent@account>] [--fork]`, `orch limits`, `orch move <run> --to <agent@account>`, `orch specs …` (spec-queue.md §13), `orch bug-report [--out <folder>]`, `orch uninstall`. |
| CLI-02 | Exit codes: 0 success, 1 problem found (e.g. doctor failures), 2 invalid usage, 3 engine unavailable. |
| CLI-03 | Output for list commands matches `design/prototype/Terminal.dc.html`; `--json` prints the contract objects. |
| CLI-04 | Plain `orch`: (a) in an interactive terminal, open the app, or focus it if it's running; exit 0. (b) `orch <path>`: same as (a), opening that repo (resolved to its git root); if the path isn't in a git repo, print "{path} isn't inside a git repository." and exit 2. (c) No display available (e.g. a Linux server over SSH): if `orch serve` is running, print a status block (engine state, usable accounts n/m, running jobs, specs running) then "Run orch --help for all commands." and exit 0; otherwise print "No display found. Start orch without a window with: orch serve" and exit 3. (d) When stdout isn't a terminal or `CI` is set: print help, exit 0, never open a window. |
| CLI-05 | `orch --version` prints `orch {version} · engine {engine version}`. |

## Installation (INS)

| Id | Decision |
| --- | --- |
| INS-01 | No npm package. Internal workspace packages are named `@orchagents/*`, all `private: true`, linked with `workspace:*`. Never use the `@orch` scope. |
| INS-02 | The app bundles a launcher at `<app resources>/bin/orch` (`orch.cmd` on Windows) that runs the CLI on the app's built-in Node (`ELECTRON_RUN_AS_NODE=1`). |
| INS-03 | PATH per OS. Windows: the installer adds `<install dir>\bin` to the user PATH; the uninstaller removes it. Linux `.deb`: the package installs `/usr/bin/orch`. macOS: "Install orch command" creates the symlink `/usr/local/bin/orch` → launcher (asks for an admin password if needed); "Uninstall orch command" removes it. Linux AppImage: "Install orch command" creates `~/.local/bin/orch` → a wrapper that runs the AppImage with `--cli`; if `~/.local/bin` isn't on the PATH, show the exact line to add. |
| INS-04 | Offered on macOS and AppImage only (the installers handle the others): once after the first-launch check (the first time the Accounts machine check finishes on this machine), as a dialog — title "Use orch from your terminal?", text "Adds the orch command so you can run jobs and check status from any terminal.", buttons "Install orch command" (primary) and "Not now"; in the command palette: "Install orch command", "Uninstall orch command"; in the orch app menu. |
| INS-05 | Doctor check `cli_on_path`: warn if `orch` isn't on the PATH, with the per-OS install action as the fix. |

## Bug report (BUG)

| Id | Decision |
| --- | --- |
| BUG-01 | Entry points: `orch bug-report [--out <folder>]`; "Report a problem…" in the Help menu and the command palette; a "Report a problem" button on the engine-failure bar (ENG-07) and on crash dialogs (window crash only: a native dialog when the window's renderer crashes, title "orch stopped unexpectedly", buttons "Reload" and "Report a problem"; lead copy, owner to review). |
| BUG-02 | Saved as `orch-bug-report-<YYYYMMDD-HHMMSS>.zip` in `~/.orch/bug-reports/` (or `--out`). The app reveals it in the file manager; the CLI prints the full path. Bundles older than 30 days are deleted at start-up. |
| BUG-03 | Contents, exactly: `versions.json`, `doctor.json`, the last 3 days of `~/.orch/logs/`, `accounts.yaml` with emails masked, and `specs.yaml` if present. Never transcripts, repo contents, tokens, environment values or profile folders. Redact again on write; a planted-secret test must pass. |
| BUG-04 | Dialog: title "Report a problem", text "orch will save these files to a zip on your computer. Nothing is sent anywhere.", the file list, buttons "Save report" / "Cancel". After saving: "Saved to {path}" with "Show in folder" and "Open GitHub issue" (opens the new-issue page with version and OS filled in). Nothing is ever uploaded. |

## Release (REL)

| Id | Decision |
| --- | --- |
| REL-01 | Versions: semver; betas `1.0.0-beta.N`; channels `beta` and `latest`. |
| REL-02 | Updates: checked at start and every 6 hours from GitHub Releases; installed on next restart, never during an active job. |
| REL-03 | Installers: `.dmg` (universal), `.exe` (NSIS), AppImage and `.deb`. Signed and notarised on macOS, signed on Windows. |

## Vocabulary (VOC)

Use these words, in UI, docs, code names and errors:

| Use | Meaning | Don't use |
| --- | --- | --- |
| job | One goal you start | task, project |
| run | One agent working on part of a job | agent run, execution |
| session | An agent's saved conversation | chat, thread |
| worktree | A run's own copy of the repo | sandbox, workspace (for this) |
| spec | One story in the spec queue | ticket, item |
| account | One sign-in for an agent | profile (in UI), credential, login (as a noun) |
| check | Something orch runs to prove done | test (unless it is a test) |
| guardrail | A check that is always on | rule |
| verified / refuted / not verified yet | Verdicts | passed / failed (for verdicts) |
| limited | An account out of usage | throttled, rate-limited (in UI) |
