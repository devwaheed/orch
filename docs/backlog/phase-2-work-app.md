# Phase 2 · Work app (weeks 5–7)

**Goal:** start, watch, message and stop a job entirely from the desktop app.
**Gate:** the phase 2 screens match their approved baselines in both themes on all three OSes; a job can be run end to end from the app with the fake agent.

Story format as in phase 1. **Refs** = the only sources you build from. Anything not covered: stop and ask.

### S2-01 · Electron shell and process supervision
- **Owns:** `packages/app/src/{electron-main,electron-preload}`.
- **Refs:** ADR 0002, 0006; `docs/architecture.md` (Processes, Preload bridge); LOCKED SEC-02, UI-04, ENG-07.
- **Do:** single-instance app; window with SEC-02 settings; start core, engine and PTY hosts as utility processes with ENG-07 backoff; hand the window a MessagePort to the core host; tray / menu-bar icon; remember window bounds.
- **Checks:** Playwright-Electron test opens the window and reaches the core host; killing each host restarts it; a second launch focuses the first window.

### S2-02 · Design system wiring and demo mode
- **Owns:** `packages/workbench/src/browser/design/`, `packages/app/src/node/demo/`.
- **Refs:** ADR 0009; `design/README.md`; LOCKED UI-02, UI-03.
- **Do:** import tokens; bundle Plex fonts; `<Icon>`; stylelint and design ESLint in CI; `ORCH_DEMO=1` loads the prototype's sample data through fake services; Playwright-Electron harness for `design/tests/design.spec.ts`.
- **Checks:** design lint passes on an empty workbench and fails on a planted raw colour.

### S2-03 · Workbench shell
- **Owns:** `packages/workbench/src/browser/{parts,services,workbench.main.ts}`.
- **Refs:** `design/screens.md` (The shell); LOCKED PRD-06, UI-05, UI-06.
- **Do:** title bar, activity bar (order PRD-06, badges), status bar, capacity panel container, command palette framework (cmdk), contribution registry (routes, activity items, palette commands, status items), shortcuts, notifications.
- **Checks:** visual baselines for the empty shell; every UI-05 shortcut test.

### S2-04 · Work: jobs sidebar
- **Owns:** `packages/workbench/src/browser/contrib/work/sidebar/`.
- **Refs:** `design/screens.md` (Work); `IJobsService`, `IRunsService`, `JobStep`.
- **Do:** jobs tree with runs, step line ("Now: … · step i of n · try k", amber when `looping`).
- **Checks:** visual baseline; behaviour: clicking a run opens it.

### S2-05 · Work: agent panes
- **Owns:** `packages/workbench/src/browser/contrib/work/panes/`.
- **Refs:** `design/screens.md` (Work); LOCKED JOB-07; `RunLine`.
- **Do:** editor groups with tabs, split, pane header, output rendering per line kind, message box rules, run actions by status, paused-by-limit card (wired in S3-03).
- **Checks:** visual baselines; behaviours listed in screens.md (Work).

### S2-06 · Terminal dock and PTY host
- **Owns:** `packages/platform/src/shells`, `packages/app/src/electron-utility/ptyHost.ts`, `packages/workbench/src/browser/parts/terminal/`.
- **Refs:** `IShellService`; screens.md (Work, terminal dock).
- **Do:** real shells per worktree via node-pty in the PTY host; xterm.js dock with tabs, add, close, hide.
- **Checks:** shell works on all three OSes (ConPTY on Windows); killing the PTY host shows "Terminal stopped · Restart".

### S2-07 · New job (single mode)
- **Owns:** `packages/workbench/src/browser/contrib/newjob/`.
- **Refs:** screens.md (Start a job); `JobSpec`, `IJobsService.toCommand`; LOCKED JOB-05, JOB-06, JOB-08.
- **Do:** goal, mode cards (only "One job, split up" enabled until S4-01, others shown with "Coming in a later version" tooltip), orchestrator and workers pickers, checks with the two locked guardrails, limit policy, CLI line.
- **Checks:** visual baseline; behaviours in screens.md.

### S2-08 · Accounts screen and add-account dialog
- **Owns:** `packages/workbench/src/browser/contrib/accounts/`.
- **Refs:** screens.md (Accounts and Add account); `IAccountsService`; LOCKED ACC-01…ACC-10.
- **Do:** visual and config-file views kept in sync, routing rule, per-agent sections with per-OS support, shared-skills toggle, three-step add dialog with sign-in and the three checks, machine check bar.
- **Checks:** visual baselines (macOS and Windows variants); behaviours in screens.md.

### S2-09 · Baselines for phase 2
- **Owns:** `design/tests/__screenshots__/` (**human only**).
- **Do:** a person compares each phase 2 screen with the canvas and commits baselines.
