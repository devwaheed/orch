# New job

Start a new job by describing your goal, choosing how agents should collaborate, selecting accounts, and defining automated verification checks.

![New job screen](images/new-job.jpg)

## What you see

- **Goal**: a text area to describe what the agents need to achieve.
- **Job mode** ("How should agents work on this?"):
  - **One job, split up**: an orchestrator plans the work and hands parts to other agents. Best for features, bug fixes.
  - **Compare agents**: several agents get the same question; you see every answer side by side. Best for design choices, second opinions. An optional checkbox, **Combine the answers into one**, runs a final pass that compares them and writes one recommendation with where they disagreed.
  - **Council**: agents each try it in their own worktree and discuss until they agree. Best for tricky problems, big refactors. You can choose rounds before you decide: up to 3, up to 5 (the default), or up to 8.
  - **Autoloop**: Planner, Coder and Reviewer keep iterating until the goal is met. Best for long tasks you want to leave running. You agree the plan with the Planner first; then the Coder and Reviewer iterate on their own and come back to you at decision points.
- **Orchestrator**:
  - Plans the work and hands tasks to workers. Let orch choose the account, or pin one.
  - **Auto**: lets orch choose the account automatically based on headroom and routing rules. Shows `Uses <account> now`.
  - **Pinned account**: select a specific account. If the account is currently limited, orch warns you and changes the start button to **Schedule for [time]**.
- **Workers**:
  - Select which agents may participate as workers. Shows how many accounts of that agent are usable now (`X of Y accounts usable now`).
- **Done-when checks** ("How do we know it’s done?"):
  - orch runs these itself when the agents say they’re finished. Agents can’t change them, and nothing reaches Review as "verified" unless they pass.
  - Two permanent guardrails are **always on** (`guardrail · always on`):
    - **No new lint or type suppressions**: blocks adding suppressions like `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `stylelint-disable`, `# type: ignore`, `# noqa`, `//nolint`, `#[allow(`, or `@SuppressWarnings`.
    - **Lint config, tests and CI files stay unchanged**: blocks modifications to linter configs, CI workflows, and existing test files.
  - Custom checks you can add via **Add:** presets:
    - **Command** (such as `npm run build`): runs a shell command in the worktree. Each command has a default 10-minute timeout; exceeding the timeout fails the check.
    - **Web check** (such as `GET /health returns 200`): pings a local HTTP web server address entered in **App address, e.g. http://localhost:3000**.
    - **File rule** (such as `Only src/ and test/ change`): verifies that file modifications stay within permitted file patterns.
- **Limit policy** ("When an account hits its limit"):
  - **Switch account** (default): same agent, another account; wait if none.
  - **Switch agent**: hand the task to another agent in the pool.
  - **Ask me**: pause and notify me.
- **Footer**:
  - Displays the equivalent `orch run` command line in real time.
  - Includes a **Cancel** button to return to Work.
  - Shows the action button: **Start job**, **Ask [count] agents**, **Start council**, **Start with the Planner**, or **Schedule for [time]**.

## How to start a job

1. Click **New job** in the title bar (or press ⌘N on macOS, Ctrl+N elsewhere).
2. Type your prompt or goal description into the **Goal** field.
3. Select a job mode based on the complexity of the task.
4. Leave the orchestrator set to **Auto**, or pin a specific agent account.
5. In **How do we know it’s done?**, click presets under **Add:** (such as `npm run build`) or enter custom checks.
6. Choose a limit policy under **When an account hits its limit**.
7. Click the primary button in the footer to start the job.

## Good to know

- Every mode shows up in [work.md](work.md), [review.md](review.md), and [sessions.md](sessions.md) the same way.
- The capacity panel on the right remains visible while configuring a job, allowing you to see account limits and headroom in real time.
- Read-only runs (such as the orchestrator and reviewer) run directly in the main checkout with read-only access; coding runs always create independent worktrees.
