# ADR 0013: Work merged into Specs; New job becomes New spec

- **Status:** Accepted (owner decision, 2026-10-27; amends PRD-06, UI-05 and spec-queue.md §2, §5, §12, §13)
- **Date:** 2026-10-27

## Context

Work (live runs, started from New job with a free-text goal) and Specs (the queue of spec files) overlapped. The owner: work is only ever done on specs; a goal on its own is not a unit of work. Spec tries also went straight to the engine, so they never appeared as live runs, and the implementer got only the spec's title.

## Decision

- **One area.** The Work area leaves the activity bar. Areas: Specs, Review, Sessions · Trust, Accounts; Settings at the bottom. Specs is the default area.
- **Live view.** Specs gets a fourth view, `Live` (Queue · Agent map · Plan · Live). It is the former Work layout: jobs sidebar, editor groups, terminal. Jobs are labelled by their spec (`42 · Integration tests…`); jobs started outside a spec (`orch run`) are listed under `Not from a spec`. "Open in Work" becomes "Watch live" and opens Live with that spec's runs.
- **New spec.** New job becomes New spec (title bar button, ⌘N, palette). Fields: Title, What to do (body), the four modes (One job split up, Compare, Council, Autoloop), agents, Done when (checks, web checks, file rule → `scope`, audit lines), Run next. orch writes `<source>/<NNN>-<slug>.md` (source from `.orch/specs.yaml`, default `docs/specs`, created if missing), id = highest id + 1, 3 digits, and adds it last in the queue; Run next moves it ahead of every other queued spec. No done-when lines → one audit line `The goal is met`.
- **Spec front matter** gains `mode` (default `single`) and `agents` (compare/council: 2+; autoloop: planner, coder, reviewer; empty = orch picks). Existing files stay valid.
- **A try is a job.** Each spec try starts a real job through the jobs service (goal = title + body, mode, agents, the spec's checks), so it shows in Live and Sessions; `SpecRun.jobId` is that job. Audits run as a read-only run by a different agent and can fail.
- **Shortcuts:** ⌘1 Specs, ⌘2 Review, ⌘3 Sessions, ⌘4 Trust, ⌘5 Accounts. ⌘N New spec.
- **CLI:** `orch specs add "<title>"` with the same fields as New spec. `orch run` stays for scripting.

## Consequences

- Help pages: Work and New job pages become Specs → Live and New spec.
- `orch run` jobs still exist but are second-class: they show only under `Not from a spec`.
