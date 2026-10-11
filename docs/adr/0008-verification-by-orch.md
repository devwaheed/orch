# ADR 0008: Verification by orch, never by the agent

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Agents report success that isn't true, and under pressure weaken tests or add lint suppressions.

## Decision

Checks are declared per job and run by orch (through Claw's verifier), not by the agent. Two guardrails are always on: no new suppressions, and lint config, tests and CI files unchanged. Only verified worktrees can merge. Corrections are fixed at the strongest layer (codebase, lint, agent rule, review note).

## Consequences

Slower first passes, far fewer false "done"s. Trust levels per agent are earned from verified results and promoted manually.
