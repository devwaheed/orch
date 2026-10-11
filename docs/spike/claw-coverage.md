# Claw v7.5.6 coverage of orch engine contract (S0-04)

Paths below are relative to the Claw package root at tag v7.5.6. Library entry: `package.json` `main: ./dist/src/index.js`, no `exports` map (so deep imports such as `dist/src/kernel/templates/index.js` work).

## 1. Request coverage

| Engine request | Claw API | Status |
|---|---|---|
| `health.ping` | `SessionManager.getVersion()` `src/session-manager.ts:1822` | Partial: returns version only, no engine/CLI readiness probe |
| `session.start` | `SessionManager.startSession(config: Partial<SessionConfig>)` `session-manager.ts:662` → `_doStartSession` `:694` → `_startReservedSession` `:719` → `_createSession` `:2652` | Covered, no `env` (see §2) |
| `session.send` | `sendMessage(name, message, opts)` `session-manager.ts:819` | Covered |
| `session.stop` | `stopSession(name, {keepPersisted})` `session-manager.ts:1393` | Covered |
| `session.resume` | No dedicated method. Resume by `resumeSessionId` (`types.ts:289`, used `session-manager.ts:729`) or implicit auto-resume by session name from the registry (`session-manager.ts:728-729`). Codex has `codexResume` `session-manager.ts:2140` | Partial: no `env` on resume |
| `session.handoff` | `handoffSession(name, {engine, model, newName, message, maxChars, customEngine})` `session-manager.ts:986`; inherits cwd/permission/sandbox/effort/budget/system prompts only (`:1022-1030`) | Partial: no `env`; `customEngine` passes through |
| `workflow.start` | `workflowStart(spec: WorkflowSpec, {runId, cwd, contract})` `session-manager.ts:1304` → `RunKernel.start` `kernel/engine.ts:516` | Covered for solve/council/fanout (see §3). No `envByNode` |
| `workflow.status` | `workflowStatus(runId)` `session-manager.ts:1311` (throws if unknown) | Covered |
| `workflow.resume` | `workflowResume(runId, {secrets})` `session-manager.ts:1333` → `RunKernel.resume` `kernel/engine.ts:594` | Covered |
| `workflow.cancel` | `workflowCancel(runId)` `session-manager.ts:1321` → `RunKernel.cancel` `kernel/engine.ts:678` (also calls `abort()` on live Council/Fanout handles) | Covered |
| `verify.run` | `verifyRun({cwd, contract, baseSha?, label?})` `session-manager.ts:1367` → `runContract` `verify/runner.ts:407`; evidence via `writeEvidence` | Covered; no env (not needed) |
| `ledger.query` | `readRunLedger({since, session?, engine?, parent?, verified?, limit?})` `run-ledger.ts:197`; `since` parsed by `parseSince` `run-ledger.ts:168` | Covered (rows: `RunLedgerRow` `run-ledger.ts:29-100`) |

Other requests in `packages/contracts/src/common/engine.ts`: none (the file has exactly the 12 request ops above; `EngineEvent` types are outbound only).

Other relevant library surfaces: `councilStart` `session-manager.ts:2698`, `fanoutStart` `:2808`, `autoloopStart` `:3368`, `autoloopStop` `:3519`, `autoloopResume` `:3571`, `workflowApprove` `:1346`, `workflowSteer` `:1337`, `workflowEvidence` `:1354`.

## 2. Per-session env

**Verdict: missing.** No built-in session accepts a per-session env applied to its spawns.

- `SessionConfig` (`types.ts:263-…`) has no `env` field. The only `env?:` in `types.ts` is `CustomEngineConfig.env` at `types.ts:232`.
- `startSession` spreads the caller config into the session config (`session-manager.ts:741-748`, `...config` last). An extra `env` key would survive the spread, but no built-in class reads it.
- Built-in spawns use the parent process env:
  - Claude: `spawnEnv = {...process.env, PATH}` at `persistent-session.ts:374-377`, then `baseUrl`, prompt-cache, and other flags added (`:390-408`); `spawn(resolvedBin, args, {env: spawnEnv, detached: true})` at `:414-418`.
  - Codex `persistent-codex-session.ts:330-332`; Gemini `persistent-gemini-session.ts:125-127`; Agy `persistent-agy-session.ts:273-275`; Opencode `persistent-opencode-session.ts:207-210` (only adds `OPENCODE_CONFIG_CONTENT` for read-only); Cursor `persistent-cursor-session.ts:154-156`; Grok `persistent-grok-session.ts:183-185`; Codex app-server `persistent-codex-app-session.ts:197-199`. All use `{...process.env}`.
- Only the custom engine honours an env map: `persistent-custom-session.ts:228-236` and `:487-500` use `...this.engineConfig.env`, and that comes from `CustomEngineConfig.env` (`types.ts:232`). This is static per engine config, not per session.
- Consequence: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `OPENCODE_CONFIG_DIR`, `XDG_DATA_HOME` (the orch allowlist, `engine.ts` contracts) cannot be scoped per session. Setting `process.env` in the host would be process-wide and would race across concurrent accounts. Closing this gap needs a Claw change (add `env` to `SessionConfig` and merge it into each spawn) or a custom-engine wrapper (unverified, would need its own review).

Is env logged or persisted?
- Ledger: `RunLedgerRow` has no env or account field (`run-ledger.ts:29-100`); `_recordRunTurn` `session-manager.ts:1118-1166` writes only counters and identifiers. So the ledger cannot tell which account ran a turn.
- Session registry: `_persistSession` `session-manager.ts:2380-2402` stores only name, claudeSessionId, cwd, model, engine, sandboxMode, timestamps.
- Workflow spec on disk: `sanitizeForDisk` `kernel/store.ts:139-152` drops keys named `customEngine` and the planner/coder/reviewer variants. `StartOptions.secrets` is memory-only (`kernel/engine.ts` StartOptions doc, ~`:317-335`).
- No code found that logs `spawnEnv` or `engineConfig.env`. Not audited: logger redaction (`src/logger.ts`) and whether CLI stderr echoed into `RunLedgerRow.error` (`run-ledger.ts`) could carry env values. Unsure.

## 3. Workflow templates and checkpointing

Templates (`kernel/templates/index.ts`):
- `TEMPLATE_NAMES = ['council','fanout','solve']` (`:380`).
- `solveWorkflow` `:140`: `triage` (fanout of scouts) → optional `approve` (human_gate, when `humanGate`) → `implement` (agent) → `review` (fanout, optional) → `verify` (verifier, `contract: 'run'`) → `repair-gate` (router; `visits_lt` budget = `maxRepairs`, default 3, `:121-`/`:76`). Run cannot end `completed` unless verify passes.
- `councilWorkflow` `:74`, `fanoutWorkflow` `:99`, `ultraappWorkflow` `:414` (not in `TEMPLATE_NAMES`).
- **compare: missing.** No template, no reference in `src/`.
- **autoloop: not a template.** It is a kernel node kind (`kernel/types.ts:41-52`) with an executor registered by SessionManager (`session-manager.ts` `kernel` getter, `setExecutor('autoloop', …)`). Start it with `autoloopStart` `:3368` (planner/coder/reviewer roles, `workspace`, `runId`), which calls `kernel.start` internally. Its `workflow.start` template value does not map to a `WorkflowSpec`.

How to start a template via the library (as the plugin's own `workflow_start` does, `src/index.ts:1355-1375`):
```
const spec = solveWorkflow({ task, cwd, scouts, reviewers, humanGate, maxRepairs });
const record = await manager.workflowStart(spec, { cwd, runId });
```
`solveWorkflow` is imported from `dist/src/kernel/templates/index.js`; it is not re-exported from `src/index.ts`. Council/fanout legacy wrappers: `councilStart` `:2698`, `fanoutStart` `:2808`.

Checkpoint/resume:
- Per-node commits under a lease: `createAndAcquire` `kernel/store.ts:753`, `commit` `:836`, `LEASE_TTL_MS = 60_000` `:369`, heartbeat `:371`.
- Resume re-attaches at a node boundary: `RunKernel.resume` `kernel/engine.ts:594`; `recoverPending` `kernel/store.ts:688`.
- A `human_gate` can be answered later with `workflowApprove` `session-manager.ts:1346`.
- Custom-engine secrets must be supplied again on resume (`workflowResume` `secrets`).

## 4. Data folders

| Location | Written by | Redirect |
|---|---|---|
| `$CLAWO_WF_DIR` or `~/.claw-orchestrator/wf/` | workflow runs, events, specs, node output, evidence (`kernel/store.ts:45-47`, `:70` runDir; evidence `verify/evidence.ts:42-48` under `<run>/evidence`) | `CLAWO_WF_DIR` |
| `$CLAWO_RUNS_DIR` or `~/.claw-orchestrator/runs/` | per-turn ledger, one `YYYY-MM-DD.jsonl` shard per day (`run-ledger.ts:127-129`, `:142`); never pruned (`:120-126` doc) | `CLAWO_RUNS_DIR` |
| `~/.claw-orchestrator/ultraapps/` | ultraapp store (`ultraapp/store.ts:273-277`) | `HOME` only (no Claw var) |
| `~/.claw-orchestrator/host-procs.json` | ultraapp host processes (`ultraapp/host-strategy.ts:23`) | none (hardcoded `os.homedir()`) |
| `~/.openclaw/claude-sessions.json` | session registry (`session-manager.ts:41-42`) | none (hardcoded `os.homedir()`) |
| `~/.openclaw/session-pids.json` | child PID tracking (`session-manager.ts:2406-2451`) | none |
| `~/.openclaw/server-token`, `~/.openclaw/openclaw.json` (read) | embedded server (`embedded-server.ts:205, 218, 302`); proxy config (`session-manager.ts:2270`, `proxy/handler.ts:61`) | none |
| `~/.openclaw/council-logs/` | council logs (`council.ts:828`, falls back to `/tmp` if HOME unset) | `HOME` only |
| `~/.claude/agents`, `skills`, `rules` | `createAgent`/`createSkill`/`createRule` writes, reads (`session-manager.ts:1624-1717`) | `HOME` / `cwd` argument; writes into the user's Claude config |
| `os.tmpdir()` | agy log (`persistent-agy-session.ts:144`), gemini read-only policy (`persistent-gemini-session.ts:70`), codex output schema (`persistent-codex-session.ts:296`), cursor read-only dir (`persistent-cursor-session.ts:90`), openai-compat cwd (`openai-compat.ts:1044`), fix-on-failure artifacts (`ultraapp/fix-on-failure.ts:91`) | `TMPDIR` (TEMP/TMP on Windows) |

Cannot be redirected by a Claw option: everything under `~/.openclaw/` and `~/.claude/` (hardcoded `os.homedir()`), so only `HOME`/`USERPROFILE` can move them, which also moves the user's real config. Unsure how cleanly `HOME` redirection works on Windows for these paths.

Read-only: Codex reads `$CODEX_HOME/sessions` (`persistent-codex-session.ts:157`).

## 5. Things that start on import or construction

- Importing `src/index.ts` (the package main): no server starts. The plugin object is lazy (`src/index.ts:7-9`, `:161-167`). `EmbeddedServer` and `SessionManager` are created only inside `getManager()` on the first tool call (`src/index.ts:~190-210`).
- `EmbeddedServer` (when the plugin creates it, unless `CLAWO_NO_EMBEDDED_SERVER=1`, `src/index.ts:207`): binds `127.0.0.1:18796` (`constants.ts:58`, `embedded-server.ts:184-185`, `:297`). `OPENCLAW_SERVER_HOST` overrides the host (`embedded-server.ts:185`). Serves `/v1/chat/completions` (`:675`), `/v1/models` (`:680`), `/v1/sessions` (`:685`), `/dashboard` (`:746-748`), and writes `~/.openclaw/server-token` (`:205-218`). **Must never run in orch.**
- `SessionManager` constructor (`session-manager.ts:581-609`): reads `~/.openclaw/claude-sessions.json` (`:600`-ish via `loadPersistedSessions`), runs `_cleanupOrphanedPids()` (`:600`, `:2487`), which can SIGKILL PIDs from `session-pids.json` (`:2555-2563`), and starts a `setInterval` cleanup timer every 60 s (`:608`, `constants.ts:48`), which is not `unref()`ed. The loop stays alive until `shutdown()` (`:1838-1842`). **Constructing a SessionManager has side effects. Call `shutdown()` when done.**
- Auto proxy HTTP server: started only when a claude-engine session asks for a non-Claude model (`session-manager.ts:769-776`), via `_ensureProxyServer` `:2292` → `_startProxyServer` `:2308`, `server.listen(0, '127.0.0.1')` at `:2363`. Not unref'd; closed in `shutdown` (`:1864`).
- `UltraappRouter.start()` (`ultraapp/router.ts:39`, `listenOn` `:82-88`) starts only when explicitly called (wired by `bin/cli.ts` via `setUltraappRouter`).
- Not started on import, but top-level executing: `bin/mcp-server.ts:207-208` (stdio MCP server) and `bin/acp-server.ts:84-85` (ACP over stdio). Do not import `bin/*`.
- `openai-compat.ts` `handleChatCompletion` is a function, reached only via `EmbeddedServer`.

## 6. Persistent session classes

| Engine | Class (file:line) | Process model | Spawn (binary, args) |
|---|---|---|---|
| claude | `PersistentClaudeSession` `persistent-session.ts:68` (extends EventEmitter) | Long-running stream-json process | `CLAUDE_BIN` or `claude` (`:116`, `session-manager.ts:2680`); args `-p --input-format stream-json --output-format stream-json --replay-user-messages --verbose --include-partial-messages --permission-mode <mode>` (`:196-206`) |
| codex | `PersistentCodexSession` `persistent-codex-session.ts:68` (BaseOneShot) | One process per turn | `CODEX_BIN` or `codex` (`:110`); `exec … --json`, `exec resume <thread>` (`:216-261`) |
| codex-app | `PersistentCodexAppServerSession` `persistent-codex-app-session.ts:114` (not exported from `src/index.ts`) | Long-running app-server | `codex app-server --listen stdio://` (`:196-199`) |
| gemini | `PersistentGeminiSession` `persistent-gemini-session.ts:53` (BaseOneShot) | One process per turn | `GEMINI_BIN` or `gemini` (`:59`); `-p <msg> --output-format stream-json --skip-trust`, plus `--approval-mode plan --admin-policy <file>` or `--yolo` or `--sandbox` (`:101-115`) |
| agy | `PersistentAgySession` `persistent-agy-session.ts:100` (BaseOneShot) | One process per turn | `AGY_BIN` or `agy` (`:109`); `-p <msg> --output-format stream-json --log-file <tmp>` (`:160`), `--mode plan` or `--dangerously-skip-permissions` or `--sandbox` (`:169-173`), `--conversation <id>` (`:209`) |
| opencode | `PersistentOpencodeSession` `persistent-opencode-session.ts:103` (BaseOneShot) | One process per turn | `OPENCODE_BIN` or `opencode` (`:122`); `run <msg> --format json`, `--session`, `--agent <read-only>`, `--model`, `--variant` (`:156-188`) |
| cursor / grok / custom | `persistent-cursor-session.ts:49`, `persistent-grok-session.ts:52`, `persistent-custom-session.ts:79` | cursor/grok one-shot, custom long-running | `cursor-agent` (`:73`), `grok` (`:81`) |

Only claude and codex-app keep a long-running process. The "persistent" name for the others means conversation IDs are carried across one-shot processes. Persistence is by conversation or thread ID, not a live process.

## Unsure / not checked
- Logger redaction (`src/logger.ts`) and whether any CLI stderr echoes env values into `RunLedgerRow.error`.
- Whether `kernel/engine.ts` `start` emits `KernelEvent`s that carry custom-engine env (only checked the StartOptions doc).
- Full `_loadPersistedSessions` behaviour on a corrupt registry file.
- Whether a `custom` engine wrapper script could give per-session env without a Claw change (not evaluated).
