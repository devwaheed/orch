# ADR 0011: Claw 7.5.6 with a per-session env patch; compare runs on fanout

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

Inspecting `@enderfga/claw-orchestrator` (spike S0-04) found:

- No per-session `env`. Built-in agent sessions spawn with `{...process.env}`; only custom engines take a fixed `env`. Without it, every session in one engine host shares one account.
- No `compare` workflow template. Claw ships `solve`, `council` and `fanout`; autoloop starts through `autoloopStart`, not a template.
- `CLAWO_WF_DIR` and `CLAWO_RUNS_DIR` redirect workflow and ledger data. `~/.openclaw/*` (session registry, pid file, council logs) can only be moved by changing `HOME`.
- Importing the library starts nothing, but the plugin path starts an embedded HTTP server unless `CLAWO_NO_EMBEDDED_SERVER=1`.

## Decision

- Pin `@enderfga/claw-orchestrator@7.5.6`, the newest release at least 14 days old on 2026-10-11 (ENG-01).
- Add per-session `env` with a `pnpm patch` on the pinned version: `SessionConfig.env` is merged over the inherited environment on every spawn, for sessions and for workflow nodes. It is never logged or persisted. Propose the same change upstream (S0-07) and drop the patch once it merges.
- Compare mode runs Claw's `fanout` template across its 2–5 agents; orch then runs JOB-09's "combine" step as a follow-up session. The engine contract keeps `template: 'compare'`; only the engine host maps it.
- The engine host sets `CLAWO_NO_EMBEDDED_SERVER=1`, `CLAWO_WF_DIR` and `CLAWO_RUNS_DIR` under `~/.orch/engine/` (ENG-03, ENG-04), and never imports Claw's `bin/*`.
- The engine host process runs with `HOME`/`USERPROFILE` set to `~/.orch/engine/home/`, so Claw's hard-coded `~/.openclaw/` and `~/.claw-orchestrator/` folders land inside `~/.orch/engine/`, and Claw's start-up orphan cleanup never sees PIDs from a standalone Claw install. Every agent spawn gets the user's real home back unless the account env sets its own (Antigravity).

## Consequences

Upgrading Claw means re-applying and re-testing the patch until upstream accepts it. The home redirect is a workaround until Claw adds a data-folder setting; the engine host must always `shutdown()` the SessionManager, since its constructor starts an un-unref'd timer. Real-machine spike results for ACC-02/03/04 were not gathered; the LOCKED values are used as written.
