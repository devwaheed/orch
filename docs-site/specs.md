# Specs

The Specs screen runs an ordered queue of spec files (stories), automates dependency scheduling, verifies implementation with audits, and provides visual plan, agent maps, and live execution views.

![Specs queue view](images/specs-queue.jpg)

[[diagram:spec-flow]]

## What you see

The Specs screen provides four switchable views in its header: **Queue**, **Agent map**, **Plan**, and **Live**.

- **Header**:
  - Displays the story count and source directory (by default, `docs/specs`).
  - Shows the view switcher: **Queue**, **Agent map**, **Plan**, and **Live**.
  - Provides the **Pause queue** / **Resume queue** button.
- **Progress bar**:
  - Visual summary of spec progress with category counts: **verified**, **running**, **needs you** (or **skipped**, depending on the failure rule), and **queued**.
- **The "Now" line**:
  - Summarizes the live state of the queue. For example: `Queue paused. Running specs finish; nothing new starts until you resume.` or `Spec 003 starts as soon as 002 is verified.`
- **Queue rules**:
  - **Order**:
    - **Parallel when files don’t overlap** (`waves`, default): runs up to 2 specs in parallel (configurable up to 4) as long as their file scopes do not touch the same directories. A spec with an empty scope always runs alone.
    - **One at a time** (`strict`): executes specs strictly in numeric order, one after another.
  - **Move on when**:
    - **Verified** (default): dependent specs start as soon as earlier specs pass verification checks and audit. You review changes in parallel.
    - **I approve**: dependent specs wait until you approve earlier specs in [review.md](review.md).
    - **Merged**: dependent specs wait until earlier specs are merged into `main`.
  - **If a spec fails**:
    - **Retry 2× then pause** (`retry-stop`, default): retries failed specs up to two times. If the spec still fails, it pauses in the `needs_you` state with pill `Stopped · N tries` and subtitle `Queue paused here: needs you`. Specs that do not depend on it continue running.
    - **Retry 2× then skip** (`retry-skip`): retries up to two times, then marks the spec `Skipped` and moves on. Dependent specs are blocked.

## What each state means

Every spec row displays an informative state pill and subtitle:

- `Queued`: waiting in line to be scheduled.
- `Waiting for <id>`: waiting for dependency `<id>` to satisfy the move-on condition.
- `Blocked by <id>`: waiting because dependency `<id>` stopped, was skipped, or cancelled.
- `Waiting for an account`: scheduler started the spec, but all eligible agent accounts are currently at their quota limit.
- `Running · try N` (Step 1 of 3 · implement): coding agent is implementing changes in an isolated worktree (`orch/spec-<id>`).
- `Running · try N` (Step 2 of 3 · checks): orch is executing the spec's done-when command checks and always-on guardrails.
- `Running · try N` (Step 3 of 3 · audit by `<agent>`): a different agent is auditing acceptance criteria.
- `Verified · your review`: all checks and audits passed; ready for inspection in [review.md](review.md).
- `Verified · approved`: approved by you; waiting in queue for earlier dependencies to merge.
- `Verified · merged`: rebased and merged into `main`.
- `Stopped · N tries`: failed all retries; paused because it needs your manual intervention.
- `Skipped · N tries`: skipped after exceeding retries or skipped manually.
- `Cancelled`: queue was cancelled.

## Agent map view

The **Agent map** view visualizes how active specs and agents connect across your project.

![Specs agent map view](images/specs-map.jpg)

- **Spec runner**: shows the top-level runner node for the active repository (`Spec runner · <repoName>`).
- **Active agents**: displays total active agents and token consumption (`orch · N agents working · <tokens>`).
- **Hierarchy**: connects runner → active specs → current execution steps. Clicking any agent card opens that run in the Live view.
- **Background tasks**: displays persistent tasks, such as post-spec verification gates (`runs after every verified spec`).

## Plan view

The **Plan** view provides an interactive dependency graph, stage metrics, and timeline events for complex spec pipelines.

![Specs plan view](images/specs-plan.jpg)

- **Plan list** (left panel):

![The Plan list panel grouping specs by stage with wave chips and layer toggles](images/plan-list.jpg)

  - Search input to filter specs.
  - Groups specs by lifecycle stage: **Coding**, **In review**, **Waiting on you**, **Ready**, **Blocked**, **Shipped**, and **Skipped**.
  - Displays wave chips (`W1`, `W2`, etc.) indicating scheduling execution waves.
  - Includes **Show affected path only** and layer toggles (**Dependency wires**, **Wave labels**, **Agent badges**, **All shipped specs**).
- **Wire graph** (center area):

![The Wire plan graph showing dependency wires, zoom controls, and the 24-hour events strip](images/plan-graph.jpg)

  - Visual dependency nodes connected by directional wires ("Wire plan").
  - Toggleable layers: **Dependency wires**, **Wave labels**, **Agent badges**, and **All shipped specs**.
  - Controls: **Show affected path only**, **Zoom in**, **Zoom out**, and **Fit**.
- **Details panel** (right panel):
  - Tabs: **Overview**, **Needs**, and **Events**.
  - Node metadata: wave progress (`Wave X of Y`), worktree branch, assigned Coder, Reviewer, **Depends on** list, and **Unblocks** list.
  - **Insert in terminal**: click **Insert @[file] in terminal** (e.g. `Insert @001-setup.md in terminal`) to paste the file reference directly into your open shell dock.
  - Stage metrics: displays time per stage (in minutes) for **Code**, **Verify**, **Review**, **Fix**, and **Merge**, as well as hourly cost.
- **Events strip** (bottom drawer):
  - Displays a timeline of events from the last 24 hours.
  - Status indicators show system health: **Healthy**, **Warning**, or **Critical**.

## Live view

The Live view is where you monitor active jobs, read agent output and diffs, send instructions, and control runs.

![Specs Live view](images/specs-live.jpg)

### What you see in Live

- **Jobs sidebar**: lists jobs and their runs from the open project on the left side of the screen.
  - Jobs corresponding to a spec in the queue are labelled `<spec id> · <spec title>` (spec id in mono).
  - Jobs started outside a spec appear under the section **Not from a spec** at the bottom (hidden when empty).
  - Displays a one-line step status under the open job: `Now: <name> · step <x> of <total> · try <n>`. Turns amber if a step loops.
  - Includes a **+** button that opens [new-spec.md](new-spec.md).

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

### How to inspect and control runs

1. **Open Live**: orch opens the selected spec's running run, or the most recently started running run in the project. If none is running, it opens the most recent run. You can also click a run in the Jobs sidebar; it opens in the left editor pane, or focuses the right pane if it is already open there.
2. **Split the editor**: press ⌘\ on macOS (Ctrl+\ elsewhere) or click **Split editor** in the tab bar to open two panes. Closing the last tab of the right pane closes the split.
3. **Send a message**: type in the message box at the bottom of an active run. Press Enter to send. The agent receives your message when it starts its next turn.
4. **Open a shell**: click **Shell** in the pane header or press ⌃` (Ctrl+`) to open the terminal dock in that run's worktree. You can run git commands, test scripts, or inspect modified files directly.
5. **Pause or stop a run**:
   - Click **Pause** to let the agent finish its current turn and hold execution.
   - Click **Stop** to end the session immediately. The worktree, branch, and transcript are preserved.
6. **Resume a completed run**: click **Continue** on a completed run to open the session in [sessions.md](sessions.md) and give the agent additional instructions.

### What happens when an account hits a limit

When an account exhausts its rate limit during a run, orch pauses execution without losing your work:

- The run status changes to **Paused · limit**.
- The worktree, branch, full transcript, and CLI session are preserved.
- **Resume immediately on a backup account**: click **Resume now on [agent] · [account]**. orch hands the session off to that account and the run resumes.
- **Auto-resume when quota resets**: leave the auto-resume checkbox enabled. orch waits until the reported reset time, adds a randomized delay of 0–120 seconds to prevent stampedes, and resumes the exact session automatically.
- **Advanced resume options**: click **More resume options** to open the session in [sessions.md](sessions.md), where you can hand off to another agent or fork into a new branch.

## How to pause and manage the queue

1. **Pause the queue**: click **Pause queue**. Running specs finish their current tries; no new specs start until you click **Resume queue**.
2. **Retry a stopped spec**: expand the spec row and click **Retry**. The retry resets the try counter, re-enters the queue, and unblocks dependent specs.
3. **Skip a spec**: expand the spec row and click **Skip this spec**. The queue marks it skipped and continues with independent specs.
4. **Watch live**: click **Watch live** on any spec to switch to the Live view and open its running run. If that spec has no running run, orch opens the most recently started running run in the project, or the most recent run when none is running.

## Good to know

- Spec files live in `docs/specs/*.md` (or the folder set in `.orch/specs.yaml`).
- Each spec file requires YAML front matter specifying its numeric `id`, title, acceptance criteria, and optional dependencies.
- You can validate your spec files at any time with `orch specs check`.
- If you use BMAD stories without front matter, run `orch specs init` to generate a front-matter skeleton before starting the queue.
- Specs are never automatically merged into `main`; every spec requires your approval in [review.md](review.md).
- Coding agents always work in dedicated git worktrees under `.orch/wt/<run-id>/` on branch `orch/<run-id>`.
- Read-only agents (such as the orchestrator in Autoloop or auditors in Specs) run in the main checkout with read-only access and show `main (read-only)`.
- If an Autoloop job requires plan approval, an approval card appears in the run pane with **Approve plan** and **Ask for a new plan** buttons.
