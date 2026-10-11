# AGENTS.md

You are working on **orch**, a desktop app that runs coding agents (Claude Code, Codex, Gemini CLI, OpenCode, Antigravity) across several accounts, verifies their work, and lets a person review and merge it. It is built on Claw Orchestrator, which runs hidden inside orch.

Read this file fully before every task. If anything here conflicts with a task description, this file wins; say so in your summary.

## Read first, for every task

1. The story you were given (in `docs/backlog/`). Do that story and nothing else.
2. `docs/decisions/LOCKED.md`: every product and technical value is decided there. **Never choose a value yourself.** If what you need isn't in LOCKED.md, a spec in `docs/specs/`, the contracts or `design/`, stop and ask.
3. The feature spec the story names (e.g. `docs/specs/spec-queue.md`). Implement it exactly, including copy and error messages.
4. `docs/architecture.md`: processes, layers, environments, services, channels.
5. `packages/contracts/src/common/`: the types every package shares.
6. For UI work: `design/DESIGN_RULES.md`, the matching section of `design/screens.md`, and `design/prototype/Main.dc.html`.
7. `docs/adr/` when a story touches a decision recorded there.

## Commands

| Task | Command |
| --- | --- |
| Install | `pnpm install` |
| Type-check everything | `pnpm typecheck` |
| Lint (code, architecture, design) | `pnpm lint` |
| Unit and contract tests | `pnpm test` |
| End-to-end and visual tests | `pnpm test:e2e` |
| Run the desktop app | `pnpm dev` |
| Run headless (core host + engine + PTY) | `pnpm dev:headless` |

Before you finish a task, `pnpm typecheck && pnpm lint && pnpm test` must pass, plus `pnpm test:e2e` if you touched UI or a flow.

## Where code goes

| You are building | Put it in |
| --- | --- |
| A shared type, schema, service interface, event or engine message | `packages/contracts` (**protected**: propose, don't edit) |
| Logic for accounts, quota, jobs, runs, sessions, review, trust, git, shells, doctor | `packages/platform/src/<service>/{common,node}` |
| Anything that knows an agent's folders, login or output | `packages/platform/src/adapters/node/<agent>.ts` |
| Anything that talks to Claw | `packages/platform/src/engine/node` |
| A screen or UI feature | `packages/workbench/src/browser/contrib/<area>/` |
| A shell region (title bar, activity bar, status bar…) | `packages/workbench/src/browser/parts/` |
| Electron windows, tray, updates, process supervision | `packages/app/src/electron-main` |
| A CLI command | `packages/cli` |

## Rules you must follow

**Architecture** (enforced by `pnpm lint`):
- Dependencies only go down: `base` ← `contracts` ← `platform` ← `app`/`cli`/`mcp`; `workbench` uses only `base`, `contracts`, `design`.
- Respect environment folders: `common` is plain TypeScript; `browser` never uses Node; `node` never uses the DOM.
- Only `adapters`, `git`, `shells` and the engine host may start processes. Only `platform/engine/node` imports Claw. Only `platform/profiles` reads or builds account environment variables.
- Workbench areas expose their API from `contrib/<area>/index.ts` only and never import another area's internals.

**Code:**
- Service methods return `Result<T>` and never throw across a process boundary. Errors use `OrchError` with a user-facing `message` and a `fix`.
- Validate every message crossing a process boundary with the `contracts` zod schemas.
- Use `path.join`/`path.resolve` for paths and argument arrays for processes; never build shell command strings. Everything must work on macOS, Linux and Windows.
- Never log tokens, keys, emails or full environment variables. Use the redacting logger.
- No new dependencies without saying why in your summary; prefer what's already in the repo.

**UI:** follow `design/DESIGN_RULES.md`. Tokens only, `<Icon>` only, copy word for word from `design/screens.md`. If the design doesn't cover what you need, stop and ask.

**Tests:**
- Use the fake agent and recorded fixtures (`packages/platform/test/fixtures`). Tests never call real agents or spend real quota.
- Every bug fix comes with a test that fails without the fix.
- Never delete or weaken a test to make it pass.

## Protected files: never edit

`packages/contracts/**`, `docs/decisions/**`, `docs/specs/**`, `docs/adr/**`, `design/tokens/**`, `design/icons/icons.ts`, `design/lint/**`, `design/tests/__screenshots__/**`, `tools/**`, lint and tsconfig files, `.github/workflows/**`.

If your task seems to need a change there, stop and write a proposal in your summary: what to change, why, and what else it affects.

**Never add lint or type suppressions** (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `any`) to get past an error. Fix the cause, or stop and explain.

## Stop and ask when

- The story is ambiguous or contradicts LOCKED.md, a spec, the design, the contracts or an ADR.
- You need a value (a default, limit, name, path, message, label, timeout, colour) that none of them gives.
- A locked value is marked **[SPIKE]** and not yet filled in.
- You need a contract change, a new dependency, a new screen or a new setting.
- A check fails and the fix would mean changing a protected file.
- You've tried the same fix twice and it still fails.

Stopping with a clear question is a good outcome. Guessing is not.

## Definition of done

- [ ] Only the files the story names were changed, plus their tests.
- [ ] Every value, label and message comes from LOCKED.md, a spec, the contracts or the design; ids referenced in the commit (e.g. `SQ §5`, `ACC-06`).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass (and `pnpm test:e2e` for UI or flows).
- [ ] Works on macOS, Linux and Windows (CI is green on all three).
- [ ] No new suppressions, no protected files touched, no secrets in logs.
- [ ] Summary written: what changed, how it was tested, anything you were unsure about.

## Commits and branches

One story per branch: `story/<id>-<short-name>` (e.g. `story/S1-06-profiles`). Conventional commits (`feat:`, `fix:`, `test:`, `refactor:`). Add a changeset for anything users will notice.
