# New job

Start a new job by describing your goal, choosing how agents should collaborate, selecting accounts, and defining automated verification checks.

![New job screen](images/new-job.jpg)

## What you see

- **Goal**: a text area to describe what the agents need to achieve.
- **Job mode** ("How should agents work on this?"):
  - **One job, split up**: an orchestrator plans the work and hands tasks to worker agents. Best for features and bug fixes.
  - **Compare agents**: asks 2–5 agents the same question and displays their answers side by side. Best for design choices and second opinions. An optional checkbox, **Combine the answers into one**, runs a final pass that writes one recommendation highlighting where agents disagreed.
  - **Council**: 2–5 agents work in their own independent worktrees and discuss their approaches until they agree. Best for tricky problems and large refactors. You can choose rounds before you decide: up to 3, up to 5 (the default), or up to 8.
  - **Autoloop**: three specialized roles (Planner, Coder, and Reviewer) iterate until the goal is met. Best for long tasks you want to leave running. You review and approve the plan with the Planner before coding begins.
- **Orchestrator**:
  - Plans the work and delegates tasks to workers.
  - **Auto**: lets orch choose the account automatically based on headroom and routing rules. Shows `Uses <account> now`.
  - **Pinned account**: select a specific account. If the account is currently limited, orch warns you and changes the start button to **Schedule for [time]**.
- **Workers**:
  - Select which agent accounts may participate as workers. Shows how many accounts are usable now (`X of Y accounts usable now`).
- **Done-when checks** ("How do we know it’s done?"):
  - Automated tests that orch executes itself after agents report they are finished. Agents cannot alter, suppress, or bypass these checks.
  - Two permanent guardrails are **always on**:
    - **No new lint or type suppressions**: blocks adding suppressions like `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `# type: ignore`, or `//nolint`.
    - **Lint config, tests and CI files stay unchanged**: blocks modifications to linter configs, CI workflows, and existing test files.
  - Custom checks you can add:
    - **Command**: runs a shell command in the worktree (such as `pnpm test`). Each command has a 10-minute timeout; exceeding the timeout fails the check.
    - **File rule**: verifies that specific files exist or stay unchanged.
    - **Web check**: pings a local HTTP web server address (such as `http://localhost:3000`).
- **Limit policy** ("When an account hits its limit"):
  - **Switch account** (default): hands the task to another account of the same agent; pauses and waits if none are available.
  - **Switch agent**: hands the task to another agent configured in the worker pool.
  - **Ask me**: pauses the run immediately and notifies you.
- **Footer**:
  - Displays the equivalent `orch run` command line in real time.
  - Shows the action button: **Start job**, **Ask [count] agents**, **Start council**, **Start with the Planner**, or **Schedule for [time]**.

## How to start a job

1. Click **New job** in the title bar (or press ⌘N on macOS, Ctrl+N elsewhere).
2. Type your prompt or task description into the **Goal** field.
3. Select a job mode based on the complexity of the task.
4. Leave the orchestrator set to **Auto**, or pin a specific agent account.
5. In **How do we know it’s done?**, click **Add:** to attach automated test commands (such as `pnpm test`).
6. Choose a fallback policy under **When an account hits its limit**.
7. Click the primary button in the footer to start execution.

## Good to know

- Every mode shows up in [work.md](work.md), [review.md](review.md), and [sessions.md](sessions.md) the same way.
- The capacity panel on the right remains visible while configuring a job, allowing you to see account limits and headroom in real time.
- Read-only runs (such as the orchestrator and reviewer) run directly in the main checkout with read-only access; coding runs always create independent worktrees.
