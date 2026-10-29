# Product pipeline: behaviour specification

**Status:** Locked 2026-10-29 (owner: "needs to be implemented"). Anything not covered here is out of scope: stop and ask, don't decide.
**Contract:** proposed `packages/contracts/src/common/factoryPipeline.ts` (§13; contracts are protected, so this is a proposal) · existing `FactoryStatus` (`factory.ts`) stays and is used as it is.
**Design:** to be drawn. Artboards "Product — Map", "Product — Gates", "Product — Design", "Product — Trail", "Product — Files", "New product". Until they exist, §9 and the wireframes are the reference.
**Acceptance:** every scenario in §15 is a test.

## 1. What it does

A **Product** area shows how a SaaS Factory product is getting built: every stage from the brief to review, how much is done overall and per stage, what is left, which decisions are waiting on you, and how each decision was reached. You answer the factory's gates (picks and approvals) here or in the agent chat; both write the same file. The spec queue keeps running the build, and the Product area shows the running spec in place.

orch never decides anything here. The factory owns the stages, their order and their rules; orch reads what the factory prints and calls the factory's own commands.

## 2. Where it applies

- A project is a **factory product** when it has `.factory/plan.json` (written by the factory's wizard). A project with only `docs/00-brief.md` or a `.factory/` folder and no plan is an **older factory product**: the Product area shows the empty state with **Set up the pipeline** (§10), and the existing factory read on the Specs screen keeps working.
- Projects that aren't factory products don't show the Product item at all.

## 3. Source of truth

| What | From | orch's role |
| --- | --- | --- |
| Stages, states, counts, gates | `node <factory>/scripts/factory.mjs status <repo> --json` (`FactoryPipeline`, §13) | read |
| Gate answers | `factory.mjs gate <repo> <gate-id> "<your words>" --via orch` | call |
| New product | `factory.mjs init <repo> --answers '<json>'` | call |
| Decision trail | `<repo>/decisions.tsv` (§8) | read |
| Delivery (epics, stories) | existing `factoryStatus()` (`FactoryStatus.delivery`) | read, unchanged |
| Build progress | the spec queue (`ISpecsService`), source `specs/queue` from `.orch/specs.yaml` | read, unchanged |
| Files | `docs/`, `design/`, `specs/`, `refs/` in the repo | read only |

- **Finding the factory:** the same lookup that finds `scripts/factory-status.mjs` today; `factory.mjs` sits beside it. If `<repo>/.orch/product.yaml` has `factory: <path to factory.mjs>`, that path wins (the factory's wizard writes it).
- **Running it:** through the existing command runner (spawning stays in shells, adapters, git and engine). Time limit: same as `FACTORY_TIMEOUT_MS` (90 s).
- **Validation:** every output is parsed with the `FactoryPipeline` zod schema; unknown fields are dropped so a newer factory doesn't break orch.

## 4. Stages and states

Stages come from the factory in order and belong to one of three groups: **Planning**, **Design**, **Build**. The wizard's answers decide which stages exist (a design-only product has no Build group). orch shows them exactly as given; it never adds, removes or reorders a stage.

| Factory state | Pill | Meaning |
| --- | --- | --- |
| `done` | Done | Its output files exist (and, for a gate, you answered it) |
| `have` | You had it | You supplied the document in the wizard |
| `skipped` | Skipped | You chose to skip it in the wizard. Not counted anywhere |
| `next` | Now | The task an agent is doing or should do next |
| `needs_you` | Needs you | A gate waiting on your answer |
| `queued` | Later | Not started |

A stage with `gate: true` is one of your decisions. Gates in the factory today: `confirm-brief`, `pick-reference`, `pick-palette`, `approve-prototype`, `accept-web`, `accept-console`.

## 5. Progress: counts, overall and per stage

- **Overall:** a bar and the line `{done} of {total} done · {needs_you} need you · {left} left`. `done` counts `done` and `have`; `total` excludes skipped stages.
- **Per group:** the same counts for Planning, Design and Build, each with its own bar.
- **What to expect next:** `{gates_ahead} more decisions for you` per group and overall (unanswered gates, including the open one), and the "Left" list: the remaining stage titles in order, gates marked with the decision icon.
- **Build group and the spec queue:** while the factory's `build` stage is `next`, the Build group also shows the spec queue's counts in the Specs screen's wording (§12 of spec-queue.md: verified, running, needs you, queued). The group bar uses factory stages only; the spec counts are a second line. No time estimates anywhere.

## 6. Running spec

When the spec queue has active specs (`running`, `verifying`, `auditing`, `waiting_quota`), the Map's Build node lists each one as `{spec id} · {spec title}` with the Specs screen's state text (`Running · try {n}`, `Step 2 of 3 · checks`, …) and **Watch live**, which behaves exactly like Watch live on the Specs screen. With none active and specs queued: `Next: {spec id} · {spec title}`.

## 7. Gates

- **List:** every gate with its question and, when answered, your words and when. The open gate shows first.
- **What you see before answering:** the files the gate names (`show`): contact sheets, palette sheet, prototype sheet, or the built-versus-approved pair. Images open full size; numbered tiles can be clicked to fill the answer box with that number.
- **Answering:** a text box for your words and **Record my answer**. orch runs `gate … --via orch` and then refreshes. The words are stored exactly as typed. orch never fills an answer for you and has no default.
- **Answered in chat:** an agent records your words with the same command (`--via chat`); orch shows them on the next refresh. Both are shown the same way, with "in orch" or "in chat".
- **Errors:** the factory's message is shown inline under the box with the fix line (OrchError rules).

## 8. Decision trail

`decisions.tsv` has a header row and these tab-separated columns, in order: `time` (ISO 8601), `stage` (stage id or `init`), `kind` (`decision`, `gate`, `amend`, `receipt`, `skip`, or another word the factory writes), `by` (`operator` or `agent`), `summary`, `evidence` (repo-relative paths separated by spaces, may be empty). Unknown kinds are shown as written. Rows that don't have six columns are skipped and counted in a quiet note: `{n} lines in decisions.tsv couldn't be read.`

## 9. UI

**Activity bar:** **Product** sits above **Specs**. Badge: the number of open gates (an action count, like the other badges). Shown only for factory products (§2).

**Header:** product name · view switcher **Map · Gates · Design · Trail · Files** · overall bar and counts (§5) · the "now" line: `Now: {stage title}` or `Waiting on you: {gate question}`.

**Map:** three group columns (Planning, Design, Build). Each column: group bar and counts, then its stages as rows (pill, title, the skill in muted text). Clicking a stage opens its output in Files, or for a gate opens Gates on it. The Build column also holds the running specs (§6).

**Gates:** §7.

**Design:** for each surface (web, console), three columns: **Your pick** (the reference screenshot), **Approved prototype**, **Built** (the parity pair when it exists). Under them: palette chips with each colour's job (from `design/palette.json`), assets with credit and licence (from `design/assets/manifest.json`), and the contract pill: `Locked` when `design/contract.json` exists. Missing images show `Not made yet` with the stage that makes them.

**Trail:** a timeline grouped by stage group, newest first within a group. Each row: time, stage, kind, who (`You` or `Agent`), summary, evidence links that open in Files. Filter: All · Your decisions · Agent decisions.

**Files:** a tree of `docs/`, `design/`, `specs/` and `refs/`, read-only. Markdown renders; images show; HTML prototypes open in a sandboxed webview with scripts allowed and no network.

```
┌ Product · tidemark   [Map] Gates Design Trail Files     ████████░░░░ 11 of 28 done ┐
│ Waiting on you: Which variant looks like your pick?                                │
│ ┌ Planning 6/6 ─────┐ ┌ Design 5/12 ──────────┐ ┌ Build 0/9 ─────────────────────┐ │
│ │ Done  Brief       │ │ Done  Reference pick  │ │ Later  Verification skill      │ │
│ │ Done  Research    │ │ Done  Palette         │ │ Later  Scaffold                │ │
│ │ Had   PRD         │ │ ⚑    Prototype pick   │ │ Later  Feature specs           │ │
│ │ ...               │ │ Later Contract        │ │ Next: 001 · Booking calendar   │ │
│ └ 0 more for you ───┘ └ 1 more for you ───────┘ └ 2 more for you ────────────────┘ │
│ Left: Prototype pick ⚑ · Contract · Verification skill · Scaffold · … · Review    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## 10. New product and empty states

- **No plan:** the area shows `This project hasn't been set up as a product yet.` and **Set up the pipeline**.
- **New product dialog** (also from the title bar's **New** menu and ⌘K "New product"): the factory's wizard questions, in order: Brief (text, or files and folders), What you already have (research, value map, PRD, architecture: each Generate · Skip · Choose file), Build (Marketing site · Console · Both), How far (Design only · Build the surfaces · The whole product), Specs after design (One by one · In parallel · I'll run them). **Set up** runs `init … --answers` and opens Map.
- **Factory not installed:** the existing message `SaaS Factory isn’t installed.` with its fix.
- **Factory too old** (no `factory.mjs` beside `factory-status.mjs`): `This SaaS Factory doesn’t have the pipeline yet.` Fix: `Update it with npx github:devwaheed/saas-factory.`
- **Read failed:** the existing `SaaS Factory couldn’t read this project.` with its fix, pointing at `factory.mjs status <repo> --json`.

## 11. Refresh

orch re-reads status when any of these change (debounced 500 ms): `.factory/plan.json`, `.factory/gates.json`, `decisions.tsv`, anything under `docs/`, `design/`, `specs/queue/`, and on every `spec.changed` event. Also on opening the area and after recording an answer. Never on a timer.

## 12. CLI

| Command | Does |
| --- | --- |
| `orch product status` | Prints the factory's status table for the open project (passes through) |
| `orch product gate <id> "<words>"` | Records an answer (`--via orch`) |

## 13. Proposed contract

```ts
export const PipelineStage = z.object({
  id: z.string(), title: z.string(), group: z.enum(['planning', 'design', 'build']),
  state: z.enum(['done', 'have', 'skipped', 'next', 'needs_you', 'queued']),
  gate: z.boolean().optional(), question: z.string().optional(), show: z.array(z.string()).optional(),
  skill: z.string().optional(), out: z.array(z.string()).optional(), goal: z.string().optional(),
  answer: z.object({ words: z.string(), by: z.literal('operator'), via: z.string(), at: z.string() }).nullable(),
});
const Counts = z.object({ total: z.number().int(), done: z.number().int(), next: z.number().int(),
  needs_you: z.number().int(), left: z.number().int(), gates_ahead: z.number().int() });
export const FactoryPipeline = z.object({
  product: z.string(), stages: z.array(PipelineStage), counts: Counts,
  groups: z.record(z.enum(['planning', 'design', 'build']), Counts),
  now: PipelineStage.nullable(),
});
```

Service additions to the factory service (proposal): `factoryPipeline(repoPath): Promise<Result<FactoryPipeline | null>>`, `answerFactoryGate(repoPath, gateId, words): Promise<Result<FactoryPipeline>>`, `initFactoryProduct(repoPath, answers): Promise<Result<FactoryPipeline>>`, `factoryTrail(repoPath): Promise<Result<TrailRow[]>>`. Code: `packages/platform/src/specs/factory/node/` beside `factoryStatus.ts`; UI in `packages/workbench/src/browser/contrib/product/`.

## 14. Events

`product.changed { repoPath }` after any refresh that changed the status (stage states, counts or gates). The activity-bar badge and the open view update from it.

## 15. Acceptance scenarios

| Id | Given | When | Then |
| --- | --- | --- | --- |
| PP-01 | A repo with `.factory/plan.json` | Open it | Product shows above Specs; Map shows the factory's stages in its order |
| PP-02 | A repo with no `.factory/` and no brief | Open it | No Product item |
| PP-03 | A plan with research skipped | Open Map | Research shows Skipped and is not in any count |
| PP-04 | 28 stages, 11 done, 1 gate open, 2 more gates later | Open Map | Header `11 of 28 done · 1 need you · 16 left`; per-group bars match the factory's group counts; `3 more decisions for you` overall |
| PP-05 | Open gate `approve-prototype` | Type "variant 2" and Record my answer | `factory.mjs gate … approve-prototype "variant 2" --via orch` runs; gate shows answered "in orch"; badge drops by one |
| PP-06 | Gate answered in chat | The factory writes gates.json | orch refreshes within a second, shows the answer "in chat" |
| PP-07 | Spec 042 running, try 2, checks | Open Map | Build column shows `042 · {title}` with `Step 2 of 3 · checks` and Watch live |
| PP-08 | Watch live on a running spec | Click | Same result as Watch live on the Specs screen |
| PP-09 | `decisions.tsv` with one 4-column line | Open Trail | Valid rows show; note `1 lines in decisions.tsv couldn't be read.` |
| PP-10 | No `design/contract.json` | Open Design | Contract pill absent; missing images say `Not made yet` with their stage |
| PP-11 | Factory returns a field orch doesn't know | Refresh | No error; the field is ignored |
| PP-12 | The factory rejects a gate answer | Record my answer | Its message and fix show under the box; nothing else changes |
| PP-13 | New product dialog filled, Build: Both, How far: Build, Specs: In parallel | Set up | `init` runs with those answers; Map opens with Planning, Design and Build groups; `.orch/specs.yaml` has `order: waves` |
| PP-14 | Factory without `factory.mjs` | Open a factory product | `This SaaS Factory doesn’t have the pipeline yet.` with the update fix |

## 16. Wizard and running the pipeline (owner, 2026-10-29)

Owner: "I want a wizard like new project which asks questions then does the work."

- **Wizard:** New product is a step-by-step wizard, one question per step in the factory's order (§10), with Back, Next and a step count (`Step 2 of 6`). The last step is a summary of the answers with **Set up and start**. It also asks **Who builds it** (the factory's `agent` answer: Auto, or one of your signed-in agents), shown as a step after Specs.
- **Set up and start:** runs `init … --answers`, opens Map, then starts the **pipeline run**.
- **Pipeline run:** one orch job in the product repo whose agent repeats the factory's loop: run `factory.mjs next <repo>`, do that one task with the skill it names, verify its output exists, log the decision with `factory.mjs log`, and run `next` again. It stops when `next` reports a gate waiting on you (the Map shows `Waiting on you: {question}`) or when every stage is done. The agent never answers a gate.
- **Resuming:** recording a gate answer (in orch or in chat) resumes the pipeline run in the same session when the account has room, otherwise a new session on the next account (the job's normal limit handling).
- **Build:** when the factory's `build` stage is next, the specs it wrote go to the spec queue, which runs them as today (§6). The pipeline run waits for the queue and continues with `next` when the build stage is done.
- **Map header:** shows the run's state next to the "now" line: `Working: {stage title}` with **Watch live**, `Paused` with **Resume**, or `Stopped: {reason}` with **Start again**. **Pause** and **Stop** sit in the header while it works.
- **Acceptance:** PP-15: wizard filled, Set up and start → plan.json exists, Map opens, a job starts whose first task is the factory's first `next`. PP-16: the run reaches `confirm-brief` → it stops, the badge shows 1, Map says `Waiting on you`. PP-17: answer the gate → the run resumes and the next task starts.
