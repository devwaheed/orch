# ADR 0001: Build on Claw Orchestrator, hidden inside orch

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

orch needs sessions for five agent CLIs, handoff between them, durable workflows, verification and a cost ledger. Claw Orchestrator (MIT, TypeScript) already provides all of these and is maintained. Its own dashboard covers different features and would mean a second app, login and look.

## Decision

Use Claw as orch's engine. Bundle it at an exact version, run it as a library inside orch's engine host process, keep its data under `~/.orch/engine/`, and never start its dashboard, MCP, ACP or OpenAI-compatible endpoints. Users never install, open, configure or update it. Credit it in About and the licences file. Add one upstream change, a per-session `env` (and a data-folder setting if missing); keep a fork until it merges.

## Consequences

We save months on agent integration. We depend on Claw's library API, so every API we use has a contract test and upgrades go through orch releases only. If the library lacks workflows or verification, the engine host runs Claw's server on a private socket instead, with no change above the engine package.
