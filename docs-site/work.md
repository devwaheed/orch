# Work

The Work screen is where you monitor active jobs, read agent output and diffs, send instructions, and control runs.

![The Work screen](images/work.jpg)

## What you see

![The Jobs sidebar listing active jobs, step progress, and runs](images/jobs-sidebar.jpg)

- **Jobs sidebar**: lists all jobs and their active runs on the left side of the screen.
  - Shows job titles and run identifiers (`r-<n>`).
  - Displays a one-line step status under the open job: `Now: <name> · step <x> of <total> · try <n>`. Turns amber if a step loops.
  - Includes a **Filter jobs** button and a **New job** button.

![The Run pane showing run header, terminal output with diffs, and the message box](images/run-pane.jpg)

- **Run pane header**:
  - Displays the agent badge, task title, and status pill (**Running**, **Done**, **Paused · limit**, or **Queued**).
  - Shows the agent and account name, worktree path or `main (read-only)`, and session id (`s-<4 hex>`).
  - Provides quick action buttons: **Pause**, **Stop**, **Shell**, **Review**, **Continue**, or **Start now**.
- **Run output**:
  - Live stream of agent terminal output with timestamps and glyphs.
  - File modifications and diffs shown with colored line additions and deletions.
- **Split editor**:
  - Divides the center area into two editor groups so you can compare two runs side by side.
  - Each tab displays an agent badge, run id, short task name, status dot, and close button.
  - A **Split editor** button in the tab bar opens or closes the split.
- **Message box**:
  - Sits at the bottom of the active run pane.
  - Type an instruction and press Enter to deliver it to the agent as its next turn.
  - The placeholder explains availability: `Message <agent> in <run>…` when running, `Resume the session to send messages` when paused, `Session ended · use Continue to resume it` when done, or `Starts when its dependency finishes` when queued.

![The Paused-by-limit card with resume options and auto-resume](images/paused-card.jpg)

- **Paused-by-limit card**:
  - Appears in the pane whenever an agent account reaches its rate limit: **Paused by an account limit**.
  - Explains which account hit the limit and confirms that the worktree, transcript, and CLI session are saved.
  - Provides a **Resume now on [agent] · [account]** button, an auto-resume checkbox (`Otherwise continue this exact session on <account> at <time>`), and a **More resume options** button.

![The Terminal dock running an interactive shell in the worktree](images/terminal.jpg)

- **Terminal dock**:
  - An expandable bottom drawer hosting real interactive shells (`zsh`) running in each run's worktree.
- **Capacity panel toggle**:
  - Located in the title bar (and shortcut ⌘B). Clicking a limited account badge in the status bar also opens the capacity panel ([limits.md](limits.md)).

## How to inspect and control runs

1. **Select a run**: click any run in the Jobs sidebar. The run opens in the left editor pane. If it is already open in the right pane, focus shifts there.
2. **Split the editor**: press ⌘\ on macOS (Ctrl+\ elsewhere) or click **Split editor** in the tab bar to open two panes. Closing the last tab of the right pane closes the split.
3. **Send a message**: type in the message box at the bottom of an active run. Press Enter to send. The agent receives your message when it starts its next turn.
4. **Open a shell**: click **Shell** in the pane header or press ⌃` (Ctrl+`) to open the terminal dock in that run's worktree. You can run git commands, test scripts, or inspect modified files directly.
5. **Pause or stop a run**:
   - Click **Pause** to let the agent finish its current turn and hold execution.
   - Click **Stop** to end the session immediately. The worktree, branch, and transcript are preserved.
6. **Resume a completed run**: click **Continue** on a completed run to open the session in [sessions.md](sessions.md) and give the agent additional instructions.

## What happens when an account hits a limit

When an account exhausts its rate limit during a run, orch pauses execution without losing your work:

- The run status changes to **Paused · limit**.
- The worktree, branch, full transcript, and CLI session are preserved.
- **Resume immediately on a backup account**: click **Resume now on [agent] · [account]**. orch hands the session off to that account and the run resumes.
- **Auto-resume when quota resets**: leave the auto-resume checkbox enabled. orch waits until the reported reset time, adds a randomized delay of 0–120 seconds to prevent stampedes, and resumes the exact session automatically.
- **Advanced resume options**: click **More resume options** to open the session in [sessions.md](sessions.md), where you can hand off to another agent or fork into a new branch.

## Good to know

- Coding agents always work in dedicated git worktrees under `.orch/wt/<run-id>/` on branch `orch/<run-id>`.
- Read-only agents (such as the orchestrator in Autoloop or auditors in Specs) run in the main checkout with read-only access and show `main (read-only)`.
- If an Autoloop job requires plan approval, an approval card appears in the run pane with **Approve plan** and **Ask for a new plan** buttons.
