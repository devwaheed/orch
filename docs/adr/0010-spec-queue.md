# ADR 0010: An ordered spec queue that moves on by itself

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

The main way of working is long runs of BMAD stories (for example 64 specs in one epic). Starting each one by hand wastes time and attention, and running them blindly in parallel causes conflicts and skips verification.

## Decision

Add a spec queue (Specs area) that runs spec files in order and starts the next one by itself under three rules: order (strict or parallel when file scopes don't overlap), when to move on (verified, approved or merged), and what to do after the last failed try (pause or skip). Each spec's done-when criteria are either checks run by orch or audits by a different agent. The full behaviour is locked in `docs/specs/spec-queue.md`.

## Consequences

Specs need front matter (`docs/specs/templates/spec.md`); orch never guesses criteria from prose. The queue never auto-merges in v1.0. orch becomes the only writer of BMAD's sprint-status.yaml.
