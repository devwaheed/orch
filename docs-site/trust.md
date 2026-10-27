# Trust

The Trust screen measures how reliably agents complete tasks, manages promotion along the trust ladder, and schedules the weekly Gardener.

![Trust screen showing 30-day verified rates, the trust ladder, correction layers, and the Gardener schedule](images/trust.jpg)

## What you see

- **Header**: displays **Trust** and explains: `How much agent work you can rely on without fixing it. Running more agents only helps once these numbers are good, so give agents more freedom one step at a time.`
- **Period toggle**: switch metrics between **Last 7 days** and **Last 30 days**.
- **Four stat cards**:
  - **Verified on the first try**: checks passed without a repair round.
  - **Needed a human fix**: you requested changes before merging.
  - **Refuted by checks**: agent said done, checks said no.
  - **Corrections moved up a layer**: turned into code or lint, not just notes.
- **Trust ladder**:
  - Lists each agent with its 30-day first-try verified rate and current level:
    - **1 · Review everything**: you check every change. All new agents start here.
    - **2 · Auto-repair**: retries until checks pass. Requires a 70% first-try verified rate.
    - **3 · Auto-merge low-risk**: tests, docs, small fixes. Requires an 85% first-try verified rate.
  - Highlights the **Current** level, displays **passed** for completed levels, and shows **Promote** when an agent qualifies.
- **Where corrections went**:
  - Displays where issues were addressed across the four correction layers: **1 · Codebase**, **2 · Lint or CI rule**, **3 · Agent rule**, and **4 · Review note**.
- **Gardener card**:
  - Shows the weekly cleanup scanner state (**On** or **Off**), schedule (**Runs every Monday at 09:00**, or `Runs every Monday at 09:00 on <agent> · <account>` when scheduled), and recent findings.

## How trust levels change

- **Minimum qualifying runs**: an agent must complete at least 20 runs in the last 30 days to qualify for promotion. If it has fewer than 20 runs, the ladder displays **Not enough runs yet**.
- **Manual promotion**: orch never promotes an agent automatically. When an agent reaches the required threshold (70% for Level 2, 85% for Level 3), a **Promote** button appears. You decide whether to advance the agent.
- **Falling below threshold**: if an agent's first-try rate drops 10 percentage points below its current level threshold (below 60% for Level 2 or below 75% for Level 3), the view displays **Below threshold**. orch does not demote the agent automatically, leaving the decision to you.

## Level 3 auto-merge rules

Level 3 allows low-risk changes to merge without waiting for manual review, subject to strict boundaries:

- **Single-mode jobs only**: auto-merge never applies to the spec queue ([specs.md](specs.md)). Spec queue stories always require your review.
- **Allowed file patterns**: every modified file in the diff must match:
  - `**/*.md`
  - `docs/**`
  - `test/**`
  - `tests/**`
  - `**/*.test.*`
  - `**/*.spec.*`
- **Diff size limit**: the entire diff must be fewer than 200 changed lines. Any change touching application source code or exceeding 200 lines stops for manual review in [review.md](review.md).

## Gardener

The Gardener is a maintenance job enabled by default:

- **Schedule**: runs automatically every Monday at 09:00 local time.
- **Execution**: runs on the primary account of your highest-level agent (breaking ties using account order: Claude Code, Codex, Gemini CLI, OpenCode, Antigravity).
- **Purpose**: inspects the repository for duplicate workarounds, copied boilerplate, and newly added lint suppressions.
- **Review**: Gardener proposals arrive in [review.md](review.md) as normal jobs. No changes are merged without your explicit approval.
