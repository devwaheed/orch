# Sessions

The Sessions screen lets you browse saved conversation sessions, review transcripts and worktrees, and resume, hand off, or fork agent runs.

![Sessions screen](images/sessions.jpg)

## What you see

- **Header**: displays **Sessions** and explains: `Every agent session orch has started, saved with its transcript, worktree and the CLI’s own session id.`
- **Filters**:
  - **All · [count]**: every session orch has recorded.
  - **Resumable · [count]**: sessions that can be continued, handed off, or forked.
  - **Live · [count]**: runs currently executing.
- **Session list** (left panel):
  - Shows each session's agent badge, task title, job and account info, status pill (**Live**, **Paused · limit**, **Ended**, or **Interrupted**), and last activity time.
- **Session details** (right panel):
  - **Facts table**: displays **Job**, **Agent · account**, **Worktree** path, **Run**, **Started** date and time, and **Tokens used**.
  - **Current step**: displays **Now at** (for live sessions) or **Stopped at** (for ended or paused sessions), indicating the active step, step index, and attempt number.
  - **Last activity**: timestamp of the most recent agent turn or check.
  - **Live action**: active sessions offer **Watch live** to jump directly to the Live view in [specs.md](specs.md).
  - **Resume options**: available for paused, interrupted, or ended sessions that can continue.

## The four resume options

When resuming a session, orch provides four distinct strategies:

1. **Continue this session**:
   - Resumes in the same worktree using the original account.
   - If that account is currently limited, the button becomes **Schedule for [time]** and waits for quota reset.
2. **Hand off to another account**:
   - Hands execution off to another account belonging to the same agent.
   - The session continues in the exact same worktree. The previous session transitions to `Ended` with the label `Handed off to <id>`.
3. **Hand off to another agent**:
   - Transfers the current worktree and goal to a completely different agent (for example, switching from Claude Code to Codex).
4. **Fork into a new worktree**:
   - Creates a new git branch named `orch/<run-id>-fork-<n>` branching from the worktree's current state.
   - Starts a fresh session in an independent worktree, keeping the original worktree unchanged.

> If an option has no available target (for instance, if no other account has headroom), the option is disabled and explains why.

## How to resume a session

1. Click **Sessions** in the activity bar (or press ⌘3 on macOS, Ctrl+3 elsewhere).
2. Filter by **Resumable** and select a session from the list.
3. Review the facts, stopped step, and worktree location in the details panel.
4. Select one of the four resume options:
   - **Continue this session**
   - **Hand off to another account**
   - **Hand off to another agent**
   - **Fork into a new worktree**
5. Click the primary button (**Resume session**, **Schedule for [time]**, **Resume on [account]**, **Hand off to [agent]**, or **Fork session**).
6. orch opens the run in the Live view in [specs.md](specs.md) to continue execution.

## Good to know

- Ended sessions and their full terminal transcripts are preserved for 90 days. After 90 days, orch deletes expired session records and transcripts.
- Worktrees outside orch data directories are never deleted automatically when sessions expire. You can discard them in [review.md](review.md) or delete them with git worktree commands.
