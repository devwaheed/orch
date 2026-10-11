# Screen map

Every screen in the app, where its design lives, and what must be true when it's built. One row in "Behaviours" = one test in `tests/design.spec.ts`.

Open the canvas to see any artboard live, and press **Play** to try its behaviour:
https://claude.ai/artifact/9KkN8ggG1cZsfFaEo4kkua

## The shell (every screen)

| Region | What | Notes |
| --- | --- | --- |
| Title bar (48px) | Logo, project picker, search / command button (⌘K), notifications, theme toggle, capacity toggle, **New job** | Same on every screen |
| Activity bar (56px) | **Work**, **Specs**, **Review**, **Sessions** · divider · **Trust**, **Accounts**; Settings at the bottom | Icon + short label + badge; current area highlighted (LOCKED PRD-06) |
| Jobs sidebar (264px) | Jobs tree with runs; one-line step status under the open job | **Only in Work and New job.** Never on other screens |
| Capacity panel (288px, right) | Live usage per account; read-only | Toggled from the title bar or the status bar; links only to Accounts |
| Status bar (28px) | Engine health, branch, terminal toggle, run counts, limit warning, ⌘K hint | Same on every screen |
| Command palette | Overlay from ⌘K | Actions listed in Main prototype |

## Screens

| Screen | Route | Plan phase | Prototype file(s) |
| --- | --- | --- | --- |
| Work | `/work` | 2 | `Main.dc.html`, `MainLight.dc.html` |
| Start a job | `/jobs/new` | 2 (modes in 4) | `NewJob.dc.html`, `NewJobCouncil.dc.html` |
| Command palette | overlay | 2 | `Palette.dc.html` |
| Specs | `/specs` | 4 | `Specs.dc.html`, `SpecsMap.dc.html` |
| Review | `/review` | 3 (layers in 4) | `Review.dc.html`, `ReviewRefuted.dc.html`, `ReviewLight.dc.html` |
| Sessions | `/sessions` | 3 | `Sessions.dc.html`, `SessionsLight.dc.html` |
| Capacity | panel | 3 | `Capacity.dc.html` |
| Accounts | `/accounts` | 2 | `Accounts.dc.html`, `AccountsWindows.dc.html`, `AccountsConfigLight.dc.html` |
| Add account | dialog on `/accounts` | 2 | `AddAccount.dc.html` |
| Trust | `/trust` | 4 | `Trust.dc.html` |
| CLI output | terminal | 1 | `Terminal.dc.html` |

All screen artboards are views of one prototype, `Main.dc.html`; the other files just open it in a given state (`start-view`, `theme`, `os`). Read `Main.dc.html` for exact layout, spacing, copy and state logic.

## Work

- **Components:** split editor groups with tabs (agent badge, run id, short name, status dot, close); pane header (agent badge, task, status pill, agent · account, worktree, session id, actions); agent output (time, glyph, coloured line; diffs as tinted lines); message box; paused-by-limit card; terminal dock (shell tabs per worktree, real input).
- **Run actions by status:** Running → Pause, Stop, Shell, Review · Paused → Shell, Review · Done → Continue · Queued → Start now.
- **Behaviours:**
  - Clicking a run in the sidebar opens it in the left pane; a run already open in the right pane is focused there.
  - Split button toggles one or two panes; closing the last tab of the right pane closes the split.
  - Paused card: **Resume now on Codex · Team** moves the run to Team and it shows Running; **More resume options** opens Sessions on that session; the checkbox sets auto-resume at reset.
  - Message box is disabled unless the run is Running, with the placeholder explaining why.
  - Shell action opens the terminal dock on that run's worktree.
- **Copy to keep:** "Paused by an account limit", "Otherwise continue this exact session on Personal at 15:00", "Resume the session to send messages".

## Start a job

- **Components:** goal textarea; mode cards (4); per-mode panel; orchestrator picker (Auto + accounts per agent); workers; "How do we know it's done?" checks with two locked guardrails; limit policy; footer with the equivalent CLI command and start button.
- **Behaviours:**
  - Mode change swaps the panel and the start button label: Start job · Ask N agents · Start council · Start with the Planner.
  - Picking a limited account as orchestrator shows the warning and the button becomes "Schedule for 15:00".
  - Guardrails can't be removed; added checks can.
  - The CLI line always matches the current choices.
- **Copy to keep:** mode names and one-line descriptions; "orch runs these itself when the agents say they're finished. Agents can't change them…".

## Specs

Behaviour is fully specified in `docs/specs/spec-queue.md`; this section only maps it to the design.

- **Components:** header (source, View: Queue / Agent map, Pause / Resume queue); progress bar and counts; "now" line; rules (Order, Move on when, If a spec fails); queue rows (number, title + second line, state pill, done-when n/m, agent badge + account, time · tokens) with expandable details (done-when list with who checked each, depends on, may change, Open in Work, Skip); collapsed group rows; agent map (runner → active specs → steps of the selected spec; background tasks).
- **Behaviours:** rule changes update the queue and the now line immediately and write `.orch/specs.yaml`; pausing stops new starts only; clicking an agent in the map opens it in Work.
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
