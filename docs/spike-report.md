# Spike report (phase 0)

**Date:** 2026-10-11 · **Decision record:** ADR 0011

## How this phase ran

The person owning the project chose to **take the LOCKED values for ACC-02, ACC-03 and ACC-04 as written** instead of measuring them on real machines. S0-01 to S0-03 (real logins on three OSes) and S0-06 (recorded fixtures) were therefore not run. Fixtures under `packages/platform/test/fixtures/` are synthetic, built from each agent's documented output format and Claw's parsers.

## Results

| Story | Result |
| --- | --- |
| S0-01 Claude Code isolation | Not measured; ACC-02/03 used as written (parallel on all three OSes) |
| S0-02 Codex isolation | Not measured; ACC-02/03 used as written |
| S0-03 Gemini, OpenCode, Antigravity | Not measured; ACC-02/03 used as written |
| S0-04 Claw as a library | Library covers every engine request except per-session env and a `compare` template. Details: `docs/spike/claw-coverage.md` |
| S0-05 Per-session env | Not in Claw 7.5.6 or on `main` (2026-10-09). Added with a `pnpm patch` (ADR 0011) |
| S0-06 Fixtures | Synthetic (see above) |
| S0-07 Upstream issue | Draft below; the project owner posts it |
| S0-08 Go/no-go | Go, on the decisions in ADR 0011 |

## Surprises

- `SessionManager`'s constructor kills PIDs listed in `~/.openclaw/session-pids.json` and starts an un-unref'd 60 s timer. The engine host runs Claw with its own home folder under `~/.orch/engine/home/` and always calls `shutdown()`.
- `~/.openclaw/` and `~/.claw-orchestrator/` are hard-coded to `os.homedir()`; only `CLAWO_WF_DIR` and `CLAWO_RUNS_DIR` can be redirected.
- Only Claude Code (and Codex app-server) keep a long-running process; the other agents start one process per turn and carry a conversation id.
- The ledger has no account field, so orch records which account ran a session itself.

## Still to verify on real machines (before release)

1. Two accounts of each agent running at once on macOS, Linux and Windows (S0-01 to S0-03).
2. Antigravity headless behaviour without a terminal and its keyring on each OS.
3. The who-am-I command for each agent (ACC-04).
4. Re-record fixtures from real output and diff them against the synthetic ones.

## Upstream issue draft (S0-07)

> **Title:** Per-session `env` for built-in engines (multi-account use)
>
> We embed Claw as a library to run several accounts of the same agent at once (e.g. two Claude Code logins via `CLAUDE_CONFIG_DIR`, two Codex logins via `CODEX_HOME`). Built-in sessions spawn with `{...process.env}`, so all sessions in one process share one account; only custom engines accept a fixed `env`.
>
> Proposal: add `env?: Record<string, string>` to `SessionConfig`, merged over the inherited environment on every spawn (all built-in engines, handoff, resume and workflow agent nodes), never persisted or logged. A data-folder setting for `~/.openclaw/` would also help embedders. We carry this as a small patch and are happy to send a PR.
