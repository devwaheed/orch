# ADR 0009: Design handoff as the UI's source of truth

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Agents drift from designs: raw colours, ad-hoc spacing, icon libraries, invented screens.

## Decision

The `design/` folder (tokens, icons, lint, visual tests, prototype) is the UI's source of truth. Colours, type, spacing and radius come only from tokens, icons only from the design set, enforced by stylelint and ESLint. Every screen in both themes has a visual baseline approved by a person; baselines are protected. New UI is designed on the canvas first.

## Consequences

Visual changes need a person's approval, which is the point.
