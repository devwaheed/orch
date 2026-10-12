# Review

Each run works in its own worktree. Open **Review** to inspect a run's verdict, evidence, checks, changed files, and diff.

Verdicts are **Verified**, **Refuted**, and **Not verified yet**. **Approve & merge** is available only when the verdict is Verified. orch rebases the worktree onto the target branch, runs checks and guardrails again, then squashes the changes into one commit. After a successful merge, the label is **Merged into main**.

Choose **Request changes** to send your text to the run's session as its next turn and start a new try. You can also open changes in an editor or discard them. Discard asks for confirmation and deletes the worktree and branch.

For a refuted run, **Stop this happening again** offers four correction layers: **Codebase**, **Lint or CI rule**, **Agent rule**, and **Review note**. An Agent rule is shown for your approval before it is added under `## Lessons` in the repository's `AGENTS.md`.

<!-- Source: LOCKED REV-01, REV-02, REV-03, REV-04, REV-05, REV-06; design/screens.md: Review -->
