# ADR 0003: Multiple accounts through per-account profile folders

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Each agent stores its login in its own config folder or keychain. We verified per agent and OS which can point at a different folder.

## Decision

Each account gets a private folder under `~/.orch/profiles/<agent>-<name>/`. The agent's adapter maps it to the right setting (`CLAUDE_CONFIG_DIR`, `CODEX_HOME` with file-based login, `GEMINI_CLI_HOME`, `XDG_DATA_HOME` + `OPENCODE_CONFIG_DIR`, or a separate home for Antigravity on Linux), passed to Claw as the session's `env`. orch never handles passwords or tokens. Support is declared per agent and OS (`parallel`, `single`, `unverified`) and re-checked by `orch doctor` with two throwaway profiles.

## Consequences

Agents that keep logins in a shared system keyring (Antigravity on macOS and Windows) get one account there; orch never swaps logins automatically. Any CLI update can change this, so isolation is tested nightly.
