# Phase 0 · Spike (week 1)

**Goal:** find out what is true on real machines before building anything. Every story here is **human-led or human-supervised**: agents may write throwaway scripts, but a person runs them on real macOS, Linux and Windows machines and records the results.

**Gate:** isolation proven for Claude Code and Codex on all three OSes; Claw's library (or private-socket server) covers the contract table in `docs/contracts.md`; results recorded in `docs/spike-report.md`.

Throwaway code goes in `spike/` and is deleted after phase 1 starts.

---

### S0-01 · Two Claude Code accounts at once

- **Do:** create two folders; sign in to a different account in each with `CLAUDE_CONFIG_DIR=<folder> claude`; run both at the same time on a tiny task; confirm each reports its own account. Repeat on macOS, Linux, Windows.
- **Also check:** a personal skill in `~/.claude/skills` is invisible in the second folder until its `skills` folder is linked to `~/.claude/skills`, then visible.
- **Record:** exact commands, how to read the signed-in account (for `whoAmICommand`), output samples, any keychain prompts.
- **Done when:** the results table in `docs/spike-report.md` has three green rows for Claude Code, or a written reason why not.

### S0-02 · Two Codex accounts at once

- **Do:** as S0-01 with `CODEX_HOME`, after writing `cli_auth_credentials_store = "file"` into each folder's config.
- **Record:** as S0-01, plus where usage-window data and limit errors appear in Codex output.
- **Done when:** three rows for Codex in the report.

### S0-03 · Gemini CLI, OpenCode, Antigravity

- **Do:** test `GEMINI_CLI_HOME`; `XDG_DATA_HOME` + `OPENCODE_CONFIG_DIR` (including where OpenCode keeps its login on Windows); Antigravity with a separate home folder and the system keyring disabled (Linux) and with defaults (macOS, Windows).
- **Record:** support per OS (`parallel` / `single` / `unverified`), personal skills folder paths, headless behaviour (does `agy -p` hang without a terminal?).
- **Done when:** the report's table is complete for all five agents and `supportByOs` values for every adapter are known.

### S0-04 · Claw as a library

- **Do:** in a Node child process, import Claw at the version we'll pin; start a Claude session; send a message; run the `solve` workflow on a toy repo with a `npm test` check; read node states, the verdict and the ledger.
- **Record:** which of the contract table's operations work through the library and which only through `clawo serve`; where Claw writes data and whether that can be changed.
- **Done when:** the report says either "library covers everything" or lists the gaps and confirms the private-socket fallback works for them.

### S0-05 · Per-session env (fork prototype)

- **Do:** in a fork of Claw, add an `env` option to session start, stored with the session and applied on every spawn. Start two Claude sessions with different `CLAUDE_CONFIG_DIR` at once.
- **Done when:** both sessions report different accounts, the env never appears in logs or the ledger, and the change is small enough to propose upstream (diff attached to the report).

### S0-06 · Record fixtures

- **Do:** save real output from each agent (normal run, tool calls, diffs, a limit error, a crash) and Claw's events for one workflow into `packages/platform/test/fixtures/<agent|engine>/`. Remove personal data.
- **Done when:** every adapter story in phase 1 can be tested from these files alone.

### S0-07 · Open the upstream issue

- **Do:** open an issue on Claw Orchestrator describing the multi-account use case and proposing `session_start({ env })` (and a data-folder setting if S0-04 found none).
- **Done when:** the issue link is in the report.

### S0-08 · Spike report and go/no-go

- **Do:** write `docs/spike-report.md`: results table, surprises, decisions. Update ADR 0003 by adding a new ADR if any agent's support differs from the plan.
- **Done when:** a person signs off the phase 0 gate.
