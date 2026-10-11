# ADR 0006: Core, engine and terminals in separate utility processes

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

A crash in the agent engine or a native terminal must not take down the window or lose state. The CLI and MCP need the same services as the window.

## Decision

Electron main only manages the app. The core host (all orch services and the local socket), the engine host (Claw) and the PTY host (node-pty) are Electron utility processes, connected by MessagePorts, supervised and restarted by main. Headless mode runs the same entries as Node child processes.

## Consequences

Each crash is contained and recoverable. Every boundary is typed and validated (ADR 0007).
