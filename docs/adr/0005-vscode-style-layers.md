# ADR 0005: VS Code-style layers, environments, services and contributions

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Agents will write most of the code. Without hard structure they blur boundaries and invent inconsistent APIs.

## Decision

Follow VS Code's architecture: packages layered `base` ← `contracts` ← `platform` ← `app`/`cli`/`mcp`, with `workbench` beside platform; code sorted by environment (`common`, `browser`, `node`, `electron-*`); services as interfaces with constructor injection; UI features as self-contained contributions with one public file. Enforced by dependency-cruiser, ESLint and per-environment tsconfig.

## Consequences

More folders than a small app strictly needs, in exchange for boundaries that hold as the codebase and number of agents grow.
