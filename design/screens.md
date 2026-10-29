# Screen map

Every screen in the app, where its design lives, and what must be true when it's built. One row in "Behaviours" = one test in `tests/design.spec.ts`.

Open the canvas to see any artboard live, and press **Play** to try its behaviour:
https://claude.ai/artifact/9KkN8ggG1cZsfFaEo4kkua

## The shell (every screen)

| Region | What | Notes |
| --- | --- | --- |
| Title bar (48px) | Logo, project picker, search / command button (⌘K), notifications, theme toggle, capacity toggle, **New** menu (**New spec**, **New product**) | Same on every screen |
| Activity bar (56px) | Factory product only: **Product** above **Specs**; then **Review**, **Sessions** · divider · **Trust**, **Accounts**; Settings at the bottom | Icon + short label + badge; Product badge counts open gates; current area highlighted (LOCKED PRD-06 proposal pending) |
| Jobs sidebar (264px) | Jobs tree with runs; one-line step status under the open job | **Only in Specs → Live.** Never on other screens |
| Capacity panel (288px, right) | Live usage per account; read-only | Toggled from the title bar or the status bar; links only to Accounts |
| Status bar (28px) | Engine health, branch, terminal toggle, run counts, limit warning, ⌘K hint | Same on every screen |
| Command palette | Overlay from ⌘K | Actions listed in Main prototype |

- **Activity-bar badges:** Product counts open gates; Specs counts specs in `needs_you`, Review counts ready items, and Accounts counts signed-out accounts. These are action counts. Sessions has no badge.

## Screens

| Screen | Route | Plan phase | Prototype file(s) |
| --- | --- | --- | --- |
| Specs | `/specs` | 4 | `Specs.dc.html`, `SpecsMap.dc.html`, `Main.dc.html` |
| New spec | `/jobs/new` | 2 (modes in 4) | `NewJob.dc.html`, `NewJobCouncil.dc.html` |
| Command palette | overlay | 2 | `Palette.dc.html` |
| Review | `/review` | 3 (layers in 4) | `Review.dc.html`, `ReviewRefuted.dc.html`, `ReviewLight.dc.html` |
| Sessions | `/sessions` | 3 | `Sessions.dc.html`, `SessionsLight.dc.html` |
| Capacity | panel | 3 | `Capacity.dc.html` |
| Accounts | `/accounts` | 2 | `Accounts.dc.html`, `AccountsWindows.dc.html`, `AccountsConfigLight.dc.html` |
| Add account | dialog on `/accounts` | 2 | `AddAccount.dc.html` |
| Trust | `/trust` | 4 | `Trust.dc.html` |
| CLI output | terminal | 1 | `Terminal.dc.html` |

All screen artboards are views of one prototype, `Main.dc.html`; the other files just open it in a given state (`start-view`, `theme`, `os`). Read `Main.dc.html` for exact layout, spacing, copy and state logic.

## Specs → Live

- **Components:** split editor groups with tabs (agent badge, run id, short name, status dot, close); pane header (agent badge, task, status pill, agent · account, worktree, session id, actions); agent output (time, glyph, coloured line; diffs as tinted lines); message box; paused-by-limit card; terminal dock (shell tabs per worktree, real input); jobs sidebar with heading "Live" and + button opening New spec; fix in terminal slot for a spec that needs you (heading "Not met yet", failing criteria list, "Fix in terminal" button, "Check again" / "Checking…" button).
- **Jobs sidebar in Live:** a job whose id is some `SpecRun.jobId` in the loaded queue is labelled `<spec id> · <spec title>` (spec id in mono, like Specs rows). Jobs not from a spec go under a section "Not from a spec" at the bottom (hidden when empty).
- **Run actions by status:** Running → Pause, Stop, Shell, Review · Paused → Shell, Review · Done → Continue · Queued → Start now.
- **Behaviours:**
  - Clicking a run in the sidebar opens it in the left pane; a run already open in the right pane is focused there.
  - Split button toggles one or two panes; closing the last tab of the right pane closes the split.
  - Paused card: **Resume now on Codex · Team** moves the run to Team and it shows Running; **More resume options** opens Sessions on that session; the checkbox sets auto-resume at reset.
  - Message box is disabled unless the run is Running, with the placeholder explaining why.
  - Shell action opens the terminal dock on that run's worktree.
  - Fix in terminal: when the selected spec needs you (state `needs_you`, or a failed try), the run pane displays failing criteria under heading "Not met yet" above an interactive terminal. "Fix in terminal" opens the implementer agent CLI in the spec worktree with its session environment; "Check again" (shows "Checking…") runs verify + audit without starting a new implementation turn.
- **Copy to keep:** "Paused by an account limit", "Otherwise continue this exact session on Personal at 15:00", "Resume the session to send messages", "Fix in terminal", "Check again", "Checking…", "Not met yet".

## Product

- **Activity bar:** Product appears above Specs for factory products only; its badge is the count of open gates.
- **Header:** `Product · {product}`; views **Map · Gates · Design · Trail · Files**; overall progress line `{done} of {total} done · {needs_you} need you · {left} left`; the now line reads `Now: {stage title}` or `Waiting on you: {gate question}`. While a pipeline run exists, show its state and the matching Watch live, Resume, or Start again action; Pause and Stop are available while it works.
- **Map:** Planning, Design and Build columns preserve factory stage order. Each stage shows its state pill, title and skill. Group bars use factory counts, show `{gates_ahead} more decisions for you`, and Build includes active spec rows with **Watch live** or the next queued spec. A Left list shows remaining stages in order, with the decision icon on gates.
- **Gates:** a two-pane list and detail layout. The open gate is first; each gate shows its question and, when answered, the exact words, time and **in orch** / **in chat** source. The detail shows its named files, answer text area and **Record my answer** action. Numbered tiles fill the answer with that number.
- **Design:** Marketing site and Console each show **Your pick**, **Approved prototype**, and **Built** columns; palette chips, asset credit and licence, and a **Locked** contract pill appear when their factory files are available. Missing images read **Not made yet** with the stage that makes them.
- **Trail:** timeline rows are grouped by Planning, Design and Build, newest first within a group. Each row shows time, stage, kind, **You** / **Agent**, summary and evidence links. Filter: **All · Your decisions · Agent decisions**.
- **Files:** read-only tree for `docs/`, `design/`, `specs/` and `refs/`. Markdown uses the Help renderer, images display inline, and other files open through the OS with **Open** and **Show in Finder**.
- **New product wizard:** a full page with one question per step in factory order: Brief, Research, Value map, PRD, Architecture, Build, How far, Specs after design, Who builds it, then Summary. Shows `Step n of N`, **Back** / **Next**, and ends with **Set up and start**.
- **Empty and error copy:** `This project hasn’t been set up as a product yet.` / **Set up the pipeline**; `SaaS Factory isn’t installed.`; `This SaaS Factory doesn’t have the pipeline yet.` with `Update it with npx github:devwaheed/saas-factory.`; `SaaS Factory couldn’t read this project.` with the `factory.mjs status <repo> --json` fix.

## New spec

- **Components:** page title "New spec", subtitle "orch writes it to the spec folder and runs it when its turn comes. Capacity on the right is live."; Title (single line, required, max 120, placeholder "e.g. Integration tests for the callback flow"); What to do (optional body textarea, placeholder "Details for the agents: what to change, where, what to avoid"); mode cards (4); per-mode panel; orchestrator picker (Auto + accounts per agent); workers; "Done when" checks with helper text "No lines? orch adds one audit: “The goal is met”.", two locked guardrails, command checks, web checks, file rule (globs become scope), and audit lines ("Add audit line" → a text line checked by a different agent); "Run next" checkbox ("Starts before the other queued specs."); footer with the equivalent CLI command from `specs.toCommand(draft)` and submit button "Add spec" (disabled until Title is filled).
- **Behaviours:**
  - The jobs sidebar no longer shows on New spec; capacity panel on the right stays live.
  - Mode change swaps the panel and updates the draft mode and agents.
  - Picking a limited account as orchestrator shows the warning.
  - Guardrails can't be removed; added checks and audit lines can.
  - Submitting writes the spec file with the next free id and adds it to the queue (or ahead of other specs if Run next is checked), then opens Specs → Queue with the new spec's row expanded and scrolled into view.
  - On error, shows OrchError message and fix inline.
  - The CLI line always matches the current choices.

## Specs

Behaviour is fully specified in `docs/specs/spec-queue.md`; this section only maps it to the design.

- **Components:** header (source, View: Queue · Agent map · Plan · Live, Pause / Resume queue); progress bar and counts; "now" line; rules (Order, Move on when, If a spec fails); queue rows (number, title + second line, state pill, done-when n/m, agent badge + account, time · tokens) with expandable details (done-when list with who checked each, depends on, may change, Watch live, Skip); collapsed group rows; agent map (runner → active specs → steps of the selected spec; background tasks); Plan view; Live view (renders the former Work layout below header + switcher without FactoryStrip). Empty state shows "No specs yet" + "Describe what you want done and orch runs it, checks it and hands it to you for review." + primary "New spec" button.
- **Behaviours:**
  - View switcher switches between Queue (`list`), Agent map (`map`), Plan (`plan`), and Live (`live`).
  - "Watch live" (Queue row details, Plan detail panel, Agent map click, Sessions): switches to Specs → Live, expands that spec's job and opens its first active run (or first run) in the focused pane. A spec without a job yet: the button is not shown.
  - Rule changes update the queue and the now line immediately and write `.orch/specs.yaml`; pausing stops new starts only.
- **Copy to keep:** every label in spec-queue.md §12.

## Review

- **Components:** worktree list (badge, branch, run · title, state pill, +/−); detail header; verdict banner (Verified / Refuted / Not verified yet + Evidence); checks row ("Checks run by orch, not the agent"); file list; diff; note; actions (Approve & merge, secondary, Open in editor, Discard); "Stop this happening again" panel on refuted runs.
- **Behaviours:**
  - **Approve & merge is enabled only when Verified**; after merging it reads "Merged into main".
  - Secondary action by state: Request changes · Resume in Sessions (paused or interrupted).
  - Refuted run shows the four layers, strongest first; choosing one and starting it shows the confirmation line.
- **Copy to keep:** verdict texts; layer names and tags ("strongest", "agents can't skip it", "agents mostly follow it", "doesn't scale").

## Sessions

- **Components:** filter (All · Resumable · Live with counts); session list; detail (facts incl. **Stopped at / Now at**, note, last activity, resume options, CLI line, button).
- **Behaviours:**
  - Show sessions for the open project only; orch-internal sessions are hidden.
  - Sessions started by a spec run appear as one row per spec, titled **{spec id} · {spec title}**. The row shows **try N · {agent} · {account}**, the latest try's state, and **try N of N**. Expand the row to see earlier tries; the detail pane and resume or hand-off actions use the latest try.
  - Other session titles omit the retry preamble **The previous try did not meet these criteria:** when present. Filter counts count visible rows.
  - Show sessions with activity in the last 7 days by default, with **Show older** to reveal older sessions. Live and paused sessions are always shown.
  - Default resume option: Hand off to another account when the session's account is limited, else Continue this session.
  - Options with no target (no other account or agent has room) are disabled with the reason.
  - Live sessions show only **Open in workspace**.
- **Copy to keep:** the four option titles and descriptions.

## Accounts and Add account

- **Components:** Visual / Config file toggle; machine check bar ("This machine: macOS" + Run check again); routing rule; per-agent section (badge, summary, per-OS support chip with the env variable, Add account, OS note, OpenCode provider note, shared-skills row, account rows); config file view (line numbers, generated YAML).
- **Behaviours:**
  - Visual and Config file always show the same state (toggle Use, primary, shared skills, routing → YAML updates).
  - Agents limited to one account on this OS: Add account disabled with the reason; the dialog greys them out.
  - Add account dialog: Agent → Name → Sign in; Next disabled until a choice is made / sign-in done; the result lists three checks (Signed in, Kept separate, Ready); Done adds the account.
  - OpenCode shows its provider logins and the Claude Pro/Max note.
- **Copy to keep:** "Add an account, sign in once, and orch keeps it separate from the others. No folders or environment variables to manage."

## Capacity panel

- **Behaviours:** clicking an account expands its windows, source and freshness; limited accounts show "back at …"; estimated bars are striped; the gear opens Accounts. Read-only: no actions that change accounts.

## Trust

- **Components:** period toggle; four stat cards; trust ladder (agent × three steps + first-try rate); corrections by layer; gardener card with on/off and recent findings.
- **Behaviours:** Promote appears only when the agent meets the next step's rate (70% / 85%); promoting moves "Current"; nothing promotes automatically.

## States every screen must handle

Empty (no jobs, no accounts, no sessions), loading, engine restarting, offline account, and a narrow window (the shell wraps; tables scroll sideways). The prototype shows the main states; the empty and error states follow the voice rules in `DESIGN_RULES.md`.
