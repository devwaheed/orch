# Specs

The Specs screen runs an ordered queue of spec files (stories), automates dependency scheduling, verifies implementation with audits, and provides visual plan and agent maps.

![Specs queue view](images/specs-queue.jpg)

[[diagram:spec-flow]]

## What you see

The Specs screen provides three switchable views in its header: **Queue**, **Agent map**, and **Plan**.

- **Header**:
  - Displays the story count and source directory (by default, `docs/specs`).
  - Shows the view switcher: **Queue**, **Agent map**, and **Plan**.
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
- **Hierarchy**: connects runner → active specs → current execution steps. Clicking any agent card opens that run in [work.md](work.md).
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

## How to pause and manage the queue

1. **Pause the queue**: click **Pause queue**. Running specs finish their current tries; no new specs start until you click **Resume queue**.
2. **Retry a stopped spec**: expand the spec row and click **Retry**. The retry resets the try counter, re-enters the queue, and unblocks dependent specs.
3. **Skip a spec**: expand the spec row and click **Skip this spec**. The queue marks it skipped and continues with independent specs.
4. **Open in Work**: click **Open in Work** on any active or completed spec to watch execution output or send messages in [work.md](work.md).

## Good to know

- Spec files live in `docs/specs/*.md` (or the folder set in `.orch/specs.yaml`).
- Each spec file requires YAML front matter specifying its numeric `id`, title, acceptance criteria, and optional dependencies.
- You can validate your spec files at any time with `orch specs check`.
- If you use BMAD stories without front matter, run `orch specs init` to generate a front-matter skeleton before starting the queue.
- Specs are never automatically merged into `main`; every spec requires your approval in [review.md](review.md).
