# @orchagents/cli

The `orch` command line interface. Communicates with the orch core host over a local Unix domain socket (or Windows named pipe) using newline-delimited JSON-RPC 2.0 with token authentication (SEC-01).

## Commands

### `orch accounts`
List configured agent accounts and their statuses.
```bash
orch accounts [--json]
```

### `orch accounts add <agent> "<name>" [--type <type>]`
Add a new account for the specified agent and verify sign-in.
```bash
orch accounts add claude "Work" [--type <type>] [--json]
```
Supported agents: `claude`, `codex`, `gemini`, `opencode`, `agy` (PRD-05).

### `orch doctor`
Run environment and diagnostic health checks (agents, version compatibility, engine connectivity, profile isolation, disk space).
```bash
orch doctor [--json]
```

### `orch run "<goal>"`
Start a single-mode job with a goal and verification checks.
```bash
orch run "fix the failing test" --check "npm test" [--orchestrator <choice>] [--on-limit <policy>] [--workers <agents>] [--json]
```
Options:
- `--check <cmd>`: Verification check run by orch (repeatable).
- `--orchestrator <choice>`: Orchestrator agent choice (e.g. `claude`, `claude@work`; default: `claude`).
- `--on-limit <policy>`: Limit policy (`switch-account`, `switch-agent`, `ask`; default: `switch-account`).
- `--workers <agents>`: Comma-separated list of worker agents.
- `--json`: Output the job contract object as JSON.

### `orch ps`
List active jobs and agent runs.
```bash
orch ps [--json]
```

### `orch limits`
Display quota and capacity windows across accounts.
```bash
orch limits [--json]
```

### `orch sessions`
List conversation sessions.
```bash
orch sessions [--resumable] [--json]
```

## JSON Output (`--json`)

Per **CLI-03**, passing `--json` to any command outputs raw contract data objects formatted as JSON instead of human-readable tables.

## Exit Codes

Per **CLI-02**, the CLI exits with standard codes:

| Exit Code | Meaning | Examples |
|---|---|---|
| `0` | **Success** | Command completed successfully, all checks passed. |
| `1` | **Problem found** | Diagnostic checks failed (`orch doctor`), service returned an error. |
| `2` | **Invalid usage** | Missing required arguments, invalid agent name, unknown flags. |
| `3` | **Engine unavailable** | Core host is not running, socket unreachable, token missing. |
