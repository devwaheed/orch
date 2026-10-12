# Lead notes (for later briefs)

- S1-11: Claw strips `env` from disk. Engine host keeps handle→env (session and workflow envByNode) in an owner-only JSON file under ~/.orch/engine/ (values are allowlisted profile paths, no secrets) and re-applies on workflow.resume / auto-resume after restart. Never fall back to default account: if env missing on resume → error, not run.
- S1-11: engine host process HOME/USERPROFILE = ~/.orch/engine/home; session spawns get real HOME unless env sets HOME (agy). CLAWO_NO_EMBEDDED_SERVER=1, CLAWO_WF_DIR, CLAWO_RUNS_DIR under ~/.orch/engine/. Import Claw dynamically AFTER env set. Always shutdown().
- Native builds: approvals go in pnpm-workspace.yaml `onlyBuiltDependencies` (pnpm 10). Electron later needs rebuild of re2 + better-sqlite3 (+ node-pty) for Electron ABI.
- zod peer warning: Claw wants ^3.25, contracts pins 3.24.1 (protected). Warning only.
- No user guide exists; S1-05/S1-12 tested against LOCKED rules.
- Unverified-on-real-machines list (for final report): whoAmI commands, testedVersions, Windows junction/claw test skipped on win32, agy headless.

## Owner decisions 2026-10-11 (round 2)
- Unspecified error/status copy: lead/workers write it in VOC vocabulary, ONE strings file per area (UI-07); lead compiles a review list for the owner at the end. Don't stop for copy.
- Slug: trim + collapse dashes (done, deeebd2).
- Routing gaps: accept quota worker's choices (unknown ranks last; usage = max of fresh windows; near-limit primary used if no backup; null-reset limit holds until cleared).
- Lead-chosen internal values (list for owner): config watch debounce 100 ms; @types/better-sqlite3 approved; re2 build approved.
- Accounts "older" tie-break: store account.created_at; accounts service lists oldest-first.
- Internal services (store, config, profiles) keep interfaces in platform (core-host internal).
- Proposal for contracts (owner approval later): config.invalid event; store_corrupt error code.
- S1-11: SessionManager({claudeBin}) overrides CLAUDE_BIN env — pass agent binaries via SessionManager config (fake agent in tests). Verified e2e: real Claw+patch+fake agent, 2 accounts isolated (probe at scratchpad/probe/probe.mjs). Real claude with empty CLAUDE_CONFIG_DIR said 'Not logged in' → isolation works with real agent.
- Fonts: owner chose VENDORED IBM Plex woff2 files (no npm dep) in packages/workbench/src/browser/design/fonts/ + OFL licence file.
- ACC-10 opencode provider logins + Pro/Max warning: no slot in AgentAdapter contract → needs contract proposal (WhoAmI providers list) or accounts-service-only handling. gemini/agy whoAmI=null (no status cmd in gemini 0.63 / agy 1.3.3).
- Owner: writing runs = full auto in worktree (claude bypassPermissions, codex workspace-write, gemini/agy yolo); read-only runs = plan/read-only (JOB-03).
- Doctor: severity choices accepted (not installed / out of range = warn). OPEN for owner: disk free threshold (minFreeBytes). Contract proposal: IDoctorService.run(req?: {signInTwice?}). Isolation check limited by masked emails (same first letter+domain looks identical → fail-safe).
- S1-15 core host must provide: ProcessRunner (execa; env merged over process.env; argv arrays; PATHEXT on Windows) — put it in platform/src/adapters/node (adapters may start processes) and inject into doctor + accounts.
- Accounts merged. Contract proposals: SignInResult identity 'checked'|'unknown'; Account.providers for ACC-10. Lead-accepted: clash/not-ready signed-in account stored as 'signed_out'; ready = signedIn && keptSeparate. Known gaps: share toggle partial failure no rollback; setConfig doesn't drop store rows for removed accounts.
- S1-11b merged. Open: council fixer account (none today → fixer refused, checks rerun); solve synthesis account (off); engineHostMain must forward agentBins (S1-15).
- S1-15 merged. Open: process runner has no timeout (no LOCKED value); quota limits/estimates in memory only; engine child untested until S1-17; unix socket path length not checked.
- CLI: formats for ps/accounts/limits/doctor/run are extrapolated from the artboard's sessions table (artboard only shows sessions/resume/attach) → owner review list.
- Proposal (design/lint, protected): exempt a dedicated @font-face file name in stylelint; today the font-face file is named fonts/tokens.css to fit the tokens exemption.
- Guardrails: JOB-06 'test/**','tests/**' read as repo-root anchored (like gitignore; other patterns use explicit **/). Owner confirm. GUARDRAIL_COPY on review list. OpenCode big-pickle did S4-02 well.
- S2-01 merged. Follow-ups: (a) S5-01 must make app e2e run against electron-builder --dir build (install-app-deps rebuilds re2/better-sqlite3 for Electron ABI) and then wire root test:e2e to include `pnpm --filter @orch/app test:e2e`; (b) core host option to accept engine port from Electron main (today core forks own engine child; Electron starts an unused engine utility); (c) tray icon from design/icons logo (owner review); (d) workbench client must listen for window 'orch:port' message; (e) health → UI "keeps stopping" wiring; (f) unix socket path length limit on long HOME (EINVAL).
- Owner review list: window-state.json, 1100x700 centred default.
- S5-05 merged: bug report is a function only (no CLI-01 command) — needs a UI/CLI entry point decision (ENG-07 'bug-report button'); uninstall refuses while core host runs (no shutdown RPC); bundle filename/output dir lead-chosen (review list).
## Owner decisions round 3 (2026-10-11)
- APPROVED contract additions: ISpecsService.init(repoPath) + cancel(queueId); IDoctorService.run(req?: {signInTwice?}); SignInResult.identity 'checked'|'unknown'; Account.providers (ACC-10); OrchEvent config.invalid with field errors.
- Doctor disk threshold: 2 GB (minFreeBytes = 2 * 1024^3).
- node-pty 1.1.0: prebuilt spawn-helper installed without +x → posix_spawnp failed. PTY host chmods it at start. Packaged app (S5-01) must keep +x for spawn-helper in asarUnpack.
- OpenCode step-5-preview-free: left S4-04 unfinished (exited mid-task after /tmp permission rejection). Prefer big-pickle for OpenCode work.
- BUG to fix (S4-10 follow-up): 'orch specs init --repo X' — --repo on subcommands is swallowed by parent specs command; affects every specs subcommand. Copy review: --sign-in-twice option text.
- S2-00 merged. Gaps: renderer entry must call connectDataLayer(); browser MessagePort has no close event (core death → pending calls hang; use engine.health/heartbeat later); run lines uncapped in memory; specs store has no initial load; CORE_CONNECT_TIMEOUT_MS 10 s (owner review); dataStrings copy (review).
- S2-06 merged. Gap: shell.output/shell.exited not forwarded to core events channel (ShellsServiceWrapper) → needed by terminal dock UI. Copy review: spawn-helper failure reuses openFailed.
## PENDING OWNER QUESTIONS (batch)
- Gardener: goal prompt text (findings like "3 new eslint-disable comments in src/auth since the last run" in prototype gardenFinds); which repo(s) it gardens; on/off persistence (needs setting/contract); missed Monday run → skip or catch up on start; workers = same agent?
## INTEGRATION GAPS (one story I-01 after S3-01/S3-03 land)
- sessions: store table + migration v3 + store-backed repo; runs/jobs must call sessions.record() and feed session.status → applyEngineStatus; limit-clear hook (quota.available) resumes waiting sessions; fork copies uncommitted edits? (SES-03 "current worktree state" → yes: include working tree changes); SES-04 transcript deletion needs engine op (Claw?).
- quota limits/estimates persistence (in memory today).
- Electron: core host accepts engine port from main (no duplicate engine child).
- Workbench: activeProject/repo path source (title bar project picker? design shows project name "api-server" + folder icon) — run worktree path derive <repo>/.orch/wt/<run>; setNewJobServices wiring; New job checks presets.
- UI merged: shell, terminal, work, newjob, accounts. WIRING STORY W-01 needed: workbench.main after connectDataLayer → bindWorkServices, setNewJobServices, bindAccountsServices; config.invalid → accounts store without services→contrib import cycle (put config-errors store in services/stores); activeProject/repo source; Shell action → terminal open in run worktree (<repo>/.orch/wt/<run>); run lines afterSeq semantics (contract says nonNeg; first catch-up with 0 may skip seq 0 — check platform runs.lines semantics).
- DESIGN GAPS for owner (batch): ACC-08 remove control + confirm dialog absent in design; identity 'unknown' state copy; empty states (no accounts, no jobs); job/run statuses without copy (failed, stopped, scheduled, waiting_quota, paused, cancelled); config view edit behaviour; New job "Add:" presets needing inputs; New job disabled-start messaging.
- S3-03 merged (store migration v3 = run_link auto_resume/resume_fire_at). Sessions table must be v4.
- onLimit 'switch-agent' per design (NewJob routes): "Hand the task to another agent in the pool" → hand off (engine session.handoff with summary+plan, SES-02 style) to another of the job's workers with room; 'ask' = "Pause and notify me" (UI-06 notification). Implement in I-01.
- Restart: past-due auto-resume should wait for engine.ready.
- S5-01 merged. FOLLOW-UP S5-01b: package node-pty (Electron rebuild, asarUnpack, spawn-helper +x) and the PTY host in the packaged app; e2e: terminal opens a shell.
- OWNER QUESTION: macOS/Windows app id / bundle identifier (worker used com.orch.app — invented).
- OWNER QUESTION: GitHub owner/repo for releases (auto-update feed + electron-builder publish). REL-02 'active job' covers jobs.list only (spec-queue runs not readable).
- OWNER QUESTIONS (S4-01): (1) compare "combine" prompt text (JOB-09 says what, not the words); (2) contract addition for autoloop plan approval: IJobsService.approvePlan(jobId) / rejectPlan(jobId, reason?) + EngineRequest workflow.approve (Claw human_gate/workflowApprove).
- OWNER QUESTION (I-01): UI-06 notifications need an OrchEvent (e.g. run.attention {runId, reason}) for 'ask' onLimit and "spec needs you".
## Session 3 (2026-10-11/12)
- C-02 landed. Autoloop: the job goal never reached the Planner (fixed: first Planner chat message). Plan gate uses Claw's public autoloopChat (no private kernel access). Reject = reason back to the Planner, job stays at Plan. run.attention carries limit_ask only; "spec needs you" notifies from spec.changed (RunId was NOT widened).
- S5-01b landed. Packaged app e2e (temp HOME): engine ready, terminal echoes. spawn-helper check reads the asar.unpacked path (no fs monkey-patching). ELECTRON_RUN_AS_NODE removed from core child env (would break Electron-based agents/editors).
- F-06 landed. Resume never restarted the agent (session.resume only revives); now a continue message is sent; switch-agent sends the goal. Resumed runs verified by orch when the first post-resume turn ends. Handoff no longer fabricates a "Task/Completed" transcript.
- Next: C-03 compare (read-only fanout, no review row, combine step) — compare today runs writable agents in one shared worktree.
- KNOWN DEBT: engineHost reaches into Claw private `sessions` map (stopSession wrapper, ensureSessionLive, handoff). Works on 7.5.6; re-check on any Claw upgrade.
## COPY / PROMPTS FOR OWNER REVIEW (lead-drafted)
- PLANNER_MESSAGES.approved / rejected(reason) — engine/common/strings.ts
- workStrings.planApproval: "Plan approval needed", "The plan needs your approval before coding starts.", "Approve plan", "Ask for a new plan"
- NOTIFICATION_STRINGS (electron-main/notificationStrings.ts): limit ask, spec needs you, account available again, job verified, engine keeps stopping
- CONTINUE_AFTER_LIMIT, TAKE_OVER_AFTER_LIMIT(goal) — runs/common/runs.ts
- ENGINE_COPY.noTranscript — engine/common/strings.ts
- GARDENER_GOAL: "Look for drift in this repository since {since}: workarounds copied between files, new lint or type suppressions, and code that goes against the lessons in AGENTS.md. List each finding in one sentence with the files involved. Fix the ones that are small and safe in this worktree; leave the rest as findings. Don't change tests, lint configs or other protected files."
- COMPARE_COMBINE: "{n} agents worked on the same goal: "{goal}". Their answers follow. Write one recommendation: the approach you'd take and why, in a few short paragraphs. Then list every point where the answers disagree, naming which agent said what. Don't change any files."
- S4-06 landed with start_job + get_limits only. OWNER QUESTION / contract proposal: "spawn worker" (IRunsService.spawn(parentRunId, {agent, task}) → child run in the job, parentId/depth set) and "update plan" (where a job plan is stored and shown) have no contract method. zod bumped to 3.25.76 repo-wide for the MCP SDK.
- C-03 landed: compare = read-only answers in the main checkout, no review row, combine by the first compare agent with room (ponytail: not full ACC order).
- S3-03 UI landed (paused card, checked in packaged demo: Resume now moves r-04 to Codex · Team).
- P-01 landed: the title bar picker opens a native folder dialog (real mode had no way to choose a repo).
- REAL WALKTHROUGH (packaged app, temp HOME, fake claude on PATH): add account → New job → run → Review Verified → Approve & merge → commit "{title}\n\norch: job j-1, run r-1, verified …". W-01 fixed: guardrails were blind to NEW files (security); guardrail-only jobs never verified; duplicated guardrail rows; Add account empty until doctor answered; self-comparison in "kept separate".
- LEAD DECISION for owner review: a job with no declared checks is verified when both guardrails pass (New job sends only the guardrails by default). "Not run" check summary copy.
- OWNER QUESTION: how users get the `orch` CLI and orch-mcp. Nothing packages or installs them (no bin build, not in the app bundle). Options: "Install command line tool" in the app (VS Code style), an npm package, or both.
- Polish noticed: project picker shows the full path (design shows ~/code/api-server); Accounts "check" card is a blank box until the doctor answers.
- S4-03 landed (corrections; the action text is written by the user — owner question: who drafts lesson/actions).
- U-01 landed: UI-05 shortcuts, active area, Monaco codicon base rule, real-mode engine dot (core now reports an Electron-attached engine ready and replays health to late windows).
## RC CHECK (2026-10-12)
- main: typecheck, lint, 1502 tests, e2e 5/5 against the packaged --dir build.
- Packaged real mode (temp HOME, fake claude): pick folder → add account → New job → Verified → Approve & merge → commit in REV-02 format. Demo mode: every screen renders, no console errors. Real ~/.orch untouched.

## After RC (2026-10-12, workers: Codex gpt-6-luna medium, agy gemini-3.8-flash-medium)
- P-02 landed: title bar shows ~/… (home from the app bridge), Accounts check bar shows "Checking this machine…" while running (lead copy), demo initial events fire once.
- S5-04 landed: user guide as plain Markdown in docs-site/ (no generator; generator + hosting = owner). TBDs in HTML comments.
- GAPS found by the guide cross-check (RC report missed them): LOCKED CLI-01 commands `orch serve`, `orch attach`, `orch move` had no handlers; `pnpm dev:headless` was a stub; headless entries not built. In flight: CLI-03 (attach, move), HL-01 (headless + serve).
- Correction to owner question "how users get the CLI": ADR 0002 already decides it — "The `orch` command ships inside the app and on npm". Remaining work: bundle the bin in the app + npm package config (after HL-01).
- OWNER QUESTION: bug-report bundle (packages/cli bugreport) is unreachable — no CLI command (CLI-01 is "exactly" the list, no bugreport command) and no button (ENG-07 says "keeps stopping" shows a bug-report button; design has no such button). Which surface: a CLI command, the ENG-07 button, or both? And where does the bundle go (saved file location)?
- OWNER QUESTION: bare `orch` (CLI-01) has no specified behaviour (open the app? help?). Currently prints help.
- `orch move` success line "✓ moved r-02 to codex@team" is lead copy (review list).
- HL-01 landed: app build emits headless coreHost.js/engineHost.cjs/ptyHost.cjs + dist/orch.js (app-side launcher: CLI with an injected `serve`); `pnpm dev:headless` runs from source. Standalone CLI `orch serve` → exit 2 "Headless serving is unavailable in this orch installation." (lead copy). Verified live in a temp HOME: serve → accounts add (fake claude) → run → ps → stop cleans socket+token.
- CLI-03 landed: `orch attach` (catch-up + live lines, typed lines via runs.send, Ctrl-] detaches, run keeps running), `orch move` (runs.resumeOn). Verified live: attach/detach on a hanging fake run; move r-1 to claude@work. Lead fixes: no double echo of typed lines; `serve` accepts --claude-bin etc.
- Note: macOS socket paths are limited to 104 bytes; a very long HOME breaks ~/.orch/orch.sock (ENOENT on chmod). Unlikely in practice; no fix made.
- Still open for CLI packaging (ADR 0002 "inside the app and on npm"): npm package name/publish config, and how the app puts `orch` on PATH (no design for an install item). OWNER QUESTION.
- Main after this round: typecheck, lint, 1526 tests, e2e 5/5.
