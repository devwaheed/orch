# Spec queue: behaviour specification

**Status:** Locked. Implement exactly this. Anything not covered here is out of scope: stop and ask, don't decide.
**Contract:** `packages/contracts/src/common/specs.ts` · **Design:** `design/prototype/Main.dc.html` (Specs view), canvas artboards "Work — Specs".
**Acceptance:** every scenario in §15 is a test (story S4-08).

## 1. What it does

The spec queue runs an ordered list of specs (stories), each as its own job, and starts the next one by itself when the rules allow. It shows progress, the done-when criteria of each spec, and an agent map.

## 2. Spec files

- **Location:** the folder named by `source` in `.orch/specs.yaml` (default `docs/specs`). Every `*.md` file in that folder (not subfolders) is a spec.
- **File name:** `NNN-short-name.md` (e.g. `042-callback-tests.md`). The name is not used for ordering; the `id` is.
- **Front matter:** YAML between `---` lines, validated by `SpecFile`. Template: `docs/specs/templates/spec.md`.
- **Body:** free text given to the implementer as the goal, after the title. orch does not interpret it.
- **Order:** ascending numeric `id`. Stored `position` starts as this order; the user may move queued specs (§10).
- **BMAD stories:** orch never guesses criteria from prose. A story without front matter is a load problem. `orch specs init` adds a front-matter skeleton to each story that lacks one: `id` and `title` from the story, one `audit` criterion per acceptance-criteria list item, empty `depends_on` and `scope`. The user reviews these before starting.
- **sprint-status.yaml:** if `docs/sprint-status.yaml` or `docs/stories/sprint-status.yaml` exists, orch is its only writer: it sets a story to `done` when its spec is merged. The file is a protected file for agents.

## 3. Settings: `.orch/specs.yaml`

| Key | Values | Default | Meaning |
| --- | --- | --- | --- |
| `source` | path | `docs/specs` | Folder with spec files |
| `order` | `strict`, `waves` | `waves` | One at a time, or parallel when scopes don't overlap |
| `advance` | `verified`, `approved`, `merged` | `verified` | When a spec counts as done for its dependents |
| `on_fail` | `retry-stop`, `retry-skip` | `retry-stop` | What happens after the last try fails |
| `max_parallel` | 1–4 | 2 | Most specs active at once in `waves` |
| `retries` | 0–5 | 2 | Extra tries after the first (total tries = 1 + retries) |
| `after_each` | list of `{name, run, timeout_s}` | none | Shell gates run after a spec's criteria are met |

Changing a setting in the app writes this file; editing the file updates the app (same rules as `accounts.yaml`).

## 4. States and transitions

Only these transitions are allowed. The service rejects any other with `conflict`.

| From | To | When |
| --- | --- | --- |
| `queued` | `running` | Scheduler starts it (§5) and an account is available |
| `queued` | `waiting_quota` | Scheduler starts it but no account has room |
| `queued` | `blocked` | A dependency becomes `needs_you`, `skipped` or `cancelled` |
| `waiting_quota` | `running` | An account becomes available |
| `blocked` | `queued` | The blocking dependency is retried |
| `running` | `verifying` | The implementer finishes its turn |
| `verifying` | `auditing` | All check criteria and guardrails pass |
| `verifying` | `running` | A check fails and tries remain (attempt + 1) |
| `auditing` | `verified` | All audit criteria are met and every `after_each` gate passes |
| `auditing` | `running` | An audit criterion is not met, or a gate fails, and tries remain (attempt + 1) |
| `verifying`, `auditing` | `needs_you` | Fails on the last try and `on_fail = retry-stop` |
| `verifying`, `auditing` | `skipped` | Fails on the last try and `on_fail = retry-skip` |
| `running` | `waiting_quota` | The account hits its limit and no other account of that agent has room |
| `verified` | `approved` | You approve it in Review |
| `verified` | `running` | You request changes in Review (attempt + 1, does not count against `retries`) |
| `approved` | `merged` | Merge succeeds (§7) |
| `approved` | `running` | After rebasing on `main`, checks fail (attempt + 1, does not count against `retries`) |
| `needs_you`, `skipped` | `queued` | You choose Retry (attempt resets to none) |
| `queued`, `blocked`, `waiting_quota`, `needs_you` | `skipped` | You choose Skip |
| any except `merged` | `cancelled` | You cancel the queue |

## 5. Scheduler

Runs whenever a spec or queue changes, quota changes, settings change, the queue is paused or resumed, and every 30 seconds.

```text
if queue.paused: return
active   = specs in {running, verifying, auditing, waiting_quota}
capacity = 1 if order == strict else max_parallel

satisfied(dep) =
  advance == verified -> dep.state in {verified, approved, merged}
  advance == approved -> dep.state in {approved, merged}
  advance == merged   -> dep.state == merged

for spec in specs where state == queued, by position ascending:
  if any dependency (direct or indirect) is needs_you, skipped or cancelled:
      set spec blocked (blockedBy = those ids); continue
  if not all direct dependencies satisfied: continue
  if len(active) >= capacity: break
  if order == waves and active is not empty:
      if spec.scope is empty: continue              # runs only alone
      if overlaps(spec.scope, any active spec's scope): continue
  if order == strict and active is not empty: break
  start(spec); add to active
```

**Overlap** (conservative): for each glob, take its static prefix (the path segments before the first segment containing `*`, `?`, `[` or `{`). Two scopes overlap if any prefix from one equals, or is a parent path of, any prefix from the other. Example: `src/auth/**` and `src/auth/providers/github.ts` overlap; `src/auth/**` and `test/auth/**` don't. A spec whose `scope` is empty never runs alongside another spec.

**Start:** create a job (single mode) with goal = title + body, checks = the spec's check criteria + the two guardrails, worktree `orch/spec-<id>`. Implementer agent: the spec's `agent` if set, otherwise the first agent in this order that has an account with room: `claude`, `codex`, `gemini`, `opencode`, `agy`. The account comes from the quota router.

## 6. Tries, checks and audits

- A **try** is one implement → verify → audit cycle. orch counts tries itself; it starts Claw's workflow with internal repair rounds set to 0.
- A retry continues in the **same worktree** and, when the account still has room, the **same session**, with this message: `The previous try did not meet these criteria:` followed by each unmet criterion and its summary.
- **Verify:** orch runs every check criterion and both guardrails. All must pass.
- **Audit:** one audit run per spec covering all its audit criteria. The auditor must be a **different agent** from the implementer, chosen by the same agent order as §5 and the quota router. If none has room for 10 minutes, use the same agent in a fresh session on a different account if one exists, otherwise the same account; set `sameAgent: true` (shown in the UI as "same-agent audit"). The auditor answers each criterion `met` or `not_met` with a one-line reason; it may read the worktree and run read-only commands, and cannot edit files.
- **Gates:** after all criteria are met, each `after_each` gate runs in order in the spec's worktree. A gate that fails or exceeds its timeout counts as a failed try.

## 7. Review and merge

- The queue never merges without you in v1.0.
- With `advance = verified`, dependents start as soon as a spec is verified; you review in parallel.
- **Merge order:** approved specs merge in position order. A spec waits in `approved` while any spec it depends on (directly or indirectly) is not yet `merged`.
- **Before merging:** orch rebases the worktree onto `main` and re-runs the check criteria and guardrails. If they fail: back to `running` (§4).
- **After merging:** update `sprint-status.yaml` if present (§2), remove the worktree, emit `spec.changed`.

## 8. Failure and blocking

- `retry-stop`: the spec becomes `needs_you`. The queue keeps running specs that don't depend on it. Dependents become `blocked`.
- `retry-skip`: the spec becomes `skipped`. Dependents become `blocked` (they can never be satisfied by a skipped spec).
- Retry resets the attempt count and unblocks dependents (`blocked` → `queued`) once the spec is retried.

## 9. Pause, cancel, restart

- **Pause:** nothing new starts. Active specs continue to `verified`, `needs_you` or `skipped`.
- **Cancel queue:** stop all active jobs, keep their worktrees, set every non-merged spec to `cancelled`.
- **Restart of orch:** queue state is in `orch.db`. Active specs re-attach to their Claw workflows. If the engine has lost a workflow, the spec returns to `queued` with its attempt count kept and the note "Restarted after orch closed".

## 10. Reordering

Only `queued` and `blocked` specs can move. A spec can't move before any spec it depends on, and can't move after any spec that depends on it. Moving a spec never moves other specs. Invalid moves are rejected with `conflict` and the message "Spec {id} depends on {dep}, so it can't run before it." (or "Spec {dep} depends on {id}, so {id} can't move after it.").

## 11. Load problems

Loading never starts the queue while problems exist. Exact messages:

| Code | Message |
| --- | --- |
| `invalid_front_matter` | `{file}: {first schema error}. See docs/specs/templates/spec.md.` |
| `duplicate_id` | `Spec {id} is defined in both {file1} and {file2}.` |
| `unknown_dependency` | `Spec {id} depends on {dep}, which doesn't exist.` |
| `dependency_later_in_order` | `Spec {id} depends on {dep}, which comes later. Dependencies must come first.` |
| `dependency_cycle` | `Specs {a} → {b} → … → {a} depend on each other.` |
| `scope_outside_repo` | `Spec {id}: scope {glob} points outside the repository.` |

## 12. UI (Specs view)

Matches the design artboards. Where the prototype's sample text differs from this section, this section wins. Exact labels:

| State | Pill | Second line |
| --- | --- | --- |
| `queued` (deps not satisfied) | Waiting for {dep} | `Starts automatically when {dep} is {verified \| approved \| merged}` ({dep} = lowest unsatisfied dependency) |
| `queued` (ready) | Queued | `Next in line` |
| `blocked` | Blocked by {id} | `Won't run until {id} is retried` |
| `waiting_quota` | Waiting for an account | `Starts when {agent} has room ({time})` |
| `running` | Running · try {n} | `Step {i} of 3 · implement` |
| `verifying` | Running · try {n} | `Step 2 of 3 · checks` |
| `auditing` | Running · try {n} | `Step 3 of 3 · audit by {agent}` |
| `verified` | Verified · your review | `Ready in Review` |
| `approved` | Verified · approved | `Merges after {id}` or `Merging` |
| `merged` | Verified · merged | `Depends on {ids}` or empty |
| `needs_you` | Stopped · {n} tries | `Queue paused here: needs you` |
| `skipped` | Skipped · {n} tries | `Skipped; the queue moved on` |
| `cancelled` | Cancelled | empty |

- **Counts:** verified = `verified + approved + merged`; running = `running + verifying + auditing + waiting_quota`; needs you (or skipped, when `on_fail = retry-skip`) = `needs_you` (or `skipped`); queued = `queued + blocked`.
- **Grouping:** consecutive `merged` specs at the start collapse into one row `{first}–{last} · {n} specs verified and merged`; consecutive `queued` specs at the end with nothing to show collapse into `{first}–{last} · {n} specs queued; they start in order as earlier ones are verified`.
- **Now line**, first match wins: paused → `Queue paused. Running specs finish; nothing new starts until you resume.` · any `needs_you` → `Spec {id} stopped after {n} tries and needs you; specs that don't depend on it keep going.` + next sentence · otherwise → `Spec {next} starts {when}.` where `{when}` is `as soon as {dep} is verified` / `after {dep} is verified and you approve it` / `after {dep} is merged`.
- **Agent map:** root "Spec runner · {repo name}"; second column one node per active or waiting spec; third column the steps of the selected spec (implement, checks, audit). Click opens the run in Work.

## 13. CLI

| Command | Does |
| --- | --- |
| `orch specs` | List the queue as in the Specs view, one line per spec |
| `orch specs init` | Add front matter to stories that lack it (§2), then list what it added |
| `orch specs check` | Load and print problems (§11); exit code 1 if any |
| `orch specs start` / `pause` / `resume` / `cancel` | Queue control |
| `orch specs skip <id>` / `retry <id>` | Per spec |
| `orch specs move <id> <position>` | Reorder (§10) |

## 14. Events

`spec.changed` on every state, attempt or criterion change; `queue.changed` on settings, pause or resume. Each carries the full object.

## 15. Acceptance scenarios

Each is one automated test with the fake agent.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| SQ-01 | Specs 1, 2 (2 depends on 1), strict | Queue starts | 1 runs; 2 stays queued |
| SQ-02 | SQ-01, advance = verified | 1 is verified | 2 starts without any action |
| SQ-03 | SQ-01, advance = approved | 1 is verified | 2 waits until 1 is approved |
| SQ-04 | SQ-01, advance = merged | 1 is approved | 2 waits until 1 is merged |
| SQ-05 | Specs 3 (`src/a/**`), 4 (`test/a/**`), waves, max 2 | Queue starts | 3 and 4 run together |
| SQ-06 | Specs 5 (`src/a/**`), 6 (`src/a/b.ts`), waves | Queue starts | 6 waits for 5 (overlap) |
| SQ-07 | Spec 7 with empty scope, waves | Another spec is active | 7 does not start until it's alone |
| SQ-08 | Spec 8, retries = 2, check always fails | Runs | 3 tries, then needs_you; attempt shows 3 |
| SQ-09 | SQ-08 with retry-skip | Runs | skipped; queue continues |
| SQ-10 | Spec 9 depends on 8; 8 needs_you | Scheduler runs | 9 blocked, blockedBy = [8] |
| SQ-11 | SQ-10 | You retry 8 | 9 returns to queued; 8 attempt resets |
| SQ-12 | Audit criterion | Implementer is Codex | Auditor is a different agent |
| SQ-13 | Only one agent installed | Audit runs | Same agent, fresh session, sameAgent = true |
| SQ-14 | after_each gate fails | Criteria met | Counts as a failed try |
| SQ-15 | Account limited mid-run, no other account | Limit hits | waiting_quota; resumes when the account resets |
| SQ-16 | Queue paused | A spec is verified | Nothing new starts |
| SQ-17 | 10 and 11 approved, 11 depends on 10 | Merge | 10 merges first, then 11 |
| SQ-18 | Approved spec, main changed | Rebase makes a check fail | Back to running |
| SQ-19 | orch restarts mid-run | Starts again | Spec re-attaches, or returns to queued with attempt kept |
| SQ-20 | Spec depends on a later id | Load | Problem `dependency_later_in_order`; queue does not start |
| SQ-21 | Two files with the same id | Load | Problem `duplicate_id`; queue does not start |
| SQ-22 | sprint-status.yaml exists | Spec merged | Its story is set to done by orch |

## 16. Out of scope for v1.0

Auto-merge; specs across more than one repository; nested specs; editing spec files from the app (open in editor only); time estimates beyond "about N h left" computed as average time per verified spec × remaining specs.
