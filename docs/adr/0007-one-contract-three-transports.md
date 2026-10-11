# ADR 0007: One contract, three transports

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

The window, CLI, MCP and tests all need the same services, over different channels.

## Decision

Service interfaces live in `contracts`. A generic proxy exposes any service in-process, over MessagePort, or as JSON-RPC on a local socket. Every message is validated with zod on both ends; every method returns `Result<T>`; live updates are one `OrchEvent` stream carrying full objects.

## Consequences

Clients can't disagree about shapes. Contracts are protected: changing them is a deliberate, reviewed step.
