# New spec

Create a new spec by entering a title and instructions, choosing how agents collaborate, defining automated checks and audits, and optionally moving it to the front of the queue.

![New spec screen](images/new-spec.jpg)

## What you see

- **Title**: single-line title for the spec (required, max 120 characters, e.g. `Integration tests for the callback flow`).
- **What to do**: details for the agents: what to change, where, and what to avoid (optional).
- **Job mode** ("How should agents work on this?"):
  - **One job, split up**: an orchestrator plans the work and hands parts to other agents. Best for features, bug fixes.
  - **Compare agents**: several agents get the same question; you see every answer side by side. Best for design choices, second opinions. An optional checkbox, **Combine the answers into one**, runs a final pass that compares them and writes one recommendation with where they disagreed.
  - **Council**: agents each try it in their own worktree and discuss until they agree. Best for tricky problems, big refactors. You can choose rounds before you decide: up to 3, up to 5 (the default), or up to 8.
  - **Autoloop**: Planner, Coder and Reviewer keep iterating until the goal is met. Best for long tasks you want to leave running. You agree the plan with the Planner first; then the Coder and Reviewer iterate on their own and come back to you at decision points.
- **Orchestrator**:
  - Plans the work and hands tasks to workers. Let orch choose the account, or pin one.
  - **Auto**: lets orch choose the account automatically based on headroom and routing rules. Shows `Uses <account> now`.
  - **Pinned account**: select a specific account. If the account is currently limited, orch warns you.
- **Workers**:
  - Select which agents may participate as workers. Shows how many accounts of that agent are usable now (`X of Y accounts usable now`).
- **Done when**:
  - orch runs these itself when the agents say they’re finished. Agents can’t change them, and nothing reaches Review as "verified" unless they pass.
  - Helper note: *No lines? orch adds one audit: “The goal is met”.*
  - Two permanent guardrails are **always on** (`guardrail · always on`):
    - **No new lint or type suppressions**: blocks adding suppressions like `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `biome-ignore`, `stylelint-disable`, `# type: ignore`, `# noqa`, `//nolint`, `#[allow(`, or `@SuppressWarnings`.
    - **Lint config, tests and CI files stay unchanged**: blocks modifications to linter configs, CI workflows, and existing test files.
  - Custom checks you can add via **Add:** presets:
    - **Command** (such as `npm run build`): runs a shell command in the worktree. Each command has a default 10-minute timeout; exceeding the timeout fails the check.
    - **Web check** (such as `GET /health returns 200`): pings a local HTTP web server address entered in **App address, e.g. http://localhost:3000**.
    - **File rule** (such as `Only src/ and test/ change`): verifies that file modifications stay within permitted file patterns; globs define the spec's `scope`.
  - **Audit lines**:
    - Click **Add audit line** to add a text line checked by a different agent after all checks pass.
- **Run next**:
  - Checkbox: **Starts before the other queued specs.** Moves the spec ahead of other queued specs when submitted.
- **Footer**:
  - Displays the equivalent `orch specs add` command line in real time.
  - Includes a **Cancel** button to return to Specs.
  - Shows the submit button: **Add spec** (disabled until Title is filled).

## How to add a spec

1. Click **New spec** in the title bar (or press ⌘N on macOS, Ctrl+N elsewhere).
2. Enter the **Title** and optional instructions in **What to do**.
3. Select an agent collaboration mode.
4. Configure orchestrator and workers.
5. In **Done when**, add commands, web checks, file rules, or audit lines.
6. Check **Run next** if this spec should jump to the front of the queue.
7. Click **Add spec**. orch writes the spec file to `docs/specs/<NNN>-<slug>.md` and opens the Specs queue with the new spec expanded.

## Good to know

- Every mode shows up in [specs.md](specs.md), [review.md](review.md), and [sessions.md](sessions.md) the same way.
- The capacity panel on the right remains visible while configuring a spec, allowing you to see account limits and headroom in real time.
- If no checks or audit lines are entered, orch automatically adds the default audit criterion: "The goal is met".
