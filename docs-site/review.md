# Review

The Review screen lets you inspect agent work in isolated worktrees, review test and audit evidence, approve and merge verified changes, or apply structural corrections.

![Review screen](images/review.jpg)

## What you see

- **Header**: displays **Review changes** and reminds you: `Each run works in its own worktree. Nothing reaches main until you approve it here.`
- **Worktrees list** (left panel):
  - Lists all runs awaiting review.
  - Each item displays the agent badge, branch name (`orch/<run-id>`), run id, task title, status pill, and line additions/deletions (`+/−`).
- **Worktree details header**:
  - Shows the branch target (`→ main`), commit metadata, and run identifiers.
- **Verdict banner**:
  - **Verified**: all automated checks and guardrails passed. The **Approve & merge** button is active.
  - **Refuted**: the agent declared the task done, but verification checks or audits failed. Displays the **Stop this happening again** panel.
  - **Not verified yet**: checks are currently running or were interrupted.
  - **Evidence** button: opens detailed command logs and auditor rationale.
- **Checks row**:
  - Displays `Checks run by orch, not the agent:` followed by individual pass/fail badges for each check command and both locked guardrails.
- **Changed files and diff**:
  - Lists all touched files.
  - Provides a unified diff viewer showing code modifications with line numbers, additions, and deletions.
- **Actions**:
  - **Approve & merge**: merges the verified run into `main`.
  - **Request changes**: sends feedback into the run's session to start a new try.
  - **Resume in Sessions**: resumes paused or interrupted runs.
  - **Open in editor**: opens the local worktree folder in your external editor.
  - **Discard**: confirms and permanently deletes the worktree and its git branch.

## How to approve and merge

1. Open **Review** from the activity bar (or press ⌘3 on macOS, Ctrl+3 elsewhere).
2. Select a run with the **Verified** verdict.
3. Inspect the diff and click **Evidence** to review automated check outputs.
4. Click **Approve & merge**.
5. orch executes the merge sequence:
   - Rebases the worktree branch onto the project's default branch (`main`).
   - Re-runs all done-when checks and guardrails against the rebased files.
   - Squashes the commits into a single commit with message:
     ```text
     <title>

     orch: job <job>, run <run>, verified <YYYY-MM-DD>
     ```
   - Updates the status to **Merged into main** (disabling the button). The worktree remains available until discarded or cleaned up.

> Approve & merge is enabled only when a run's verdict is **Verified**. If any check fails, the button remains disabled until you request changes and the checks pass.

## How to request changes

1. Select the run in Review.
2. Click **Request changes**.
3. In the text box ("What should the agent change?"), type your guidance.
4. Click **Send request**.
5. orch delivers your feedback as the agent's next turn in the same worktree and begins a new try.

## "Stop this happening again" (Corrections)

When a run is **Refuted** because automated checks caught an error the agent claimed to have fixed, orch presents the **Stop this happening again** panel.

Fixing mistakes at the highest possible layer prevents repeated errors across all agents:

1. **Codebase** (tag: `strongest`):
   - Refactor code or add shared test helpers so that making the error is structurally impossible.
   - Action: starts a small refactor job with its own checks.
2. **Lint or CI rule** (tag: `agents can't skip it`):
   - Introduce an automated linter or CI check that blocks the mistake before code runs.
   - Action: starts a small job to write the rule and fix any flagged instances.
3. **Agent rule** (tag: `agents mostly follow it`):
   - Add an explicit instruction to the repository's `AGENTS.md` file.
   - Action: shows the proposed rule for your approval, then appends it under `## Lessons`.
4. **Review note** (tag: `doesn't scale`):
   - A reminder to inspect this issue manually during review.
   - Action: saves a note to your personal review checklist in orch.
