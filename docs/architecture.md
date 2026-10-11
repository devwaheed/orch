# Code architecture

orch follows the architecture of VS Code, the most proven Electron IDE, scaled down to what we need, plus the Electron conventions used by Orca, the closest app to ours. Every rule here is enforced by `tsconfig`, ESLint or dependency-cruiser, so agents can't drift from it.

What we take from each:

- **VS Code:** layers that only depend downwards; code sorted by the environment it runs in; services defined as interfaces and handed to their users through constructor injection; features added as self-contained "contributions"; heavy work in separate processes.
- **Orca:** the Electron split into main, preload and renderer; a single typed bridge (`window.orch`) as the window's only door to the system; React with small, selective stores.

## Processes

| Process | Runs | Code lives in |
| --- | --- | --- |
| Main | App lifecycle, windows, tray/menu bar, native notifications, auto-update. Starts and supervises the hosts below. Kept small. | `packages/app/src/electron-main` |
| Window | The UI (React). Talks only through `window.orch`. | `packages/workbench/src/browser` + `packages/app/src/electron-preload` |
| Core host | All orch services: accounts, profiles, quota, jobs, runs, sessions, review, trust, doctor, store. Also serves the local socket for the CLI and orch-mcp. | `packages/app/src/electron-utility/coreHost.ts` → `packages/platform` |
| Engine host | Claw Orchestrator as a library. Nothing else. | `packages/app/src/electron-utility/engineHost.ts` → `packages/platform/src/engine/node` |
| PTY host | Real shells (node-pty). Isolated because native terminals are the likeliest thing to crash. | `packages/app/src/electron-utility/ptyHost.ts` → `packages/platform/src/shells/node` |

The three hosts are Electron utility processes in the desktop app. In headless mode (`orch serve`, for servers without a desktop) the same entry files run as plain Node child processes. The core host never imports Electron, so it runs identically in both.

```text
 Window ──MessagePort──▶ Core host ──MessagePort──▶ Engine host ──spawns──▶ agent CLIs
   ▲                       │   ▲                                            (one account env each)
   │ preload bridge        │   └── local socket (JSON-RPC) ◀── orch CLI, orch-mcp
 Main ── starts/supervises ┴── PTY host ──▶ shells in worktrees
```

Main hands the window a MessagePort to the core host at startup; after that, UI traffic never passes through main. This is how VS Code keeps its main process responsive.

## Repository layout

```text
packages/
  base/        Utilities with no dependencies: events, disposables, Result helpers, service ids
  contracts/   Types, zod schemas, service interfaces, engine protocol, events (protected)
  platform/    Service implementations, one folder per service: <service>/{common,node}
  workbench/   The UI: parts (shell regions) and contrib (features)
  app/         Entry points: electron-main, electron-preload, electron-utility hosts, headless node
  cli/         The orch command
  mcp/         orch-mcp
design/        Design handoff: tokens, icons, lint, visual tests, prototype (protected parts)
docs/          This file, contracts guide, ADRs, backlog
```

## Layers: dependencies only go down

```text
base  ◀──  contracts  ◀──  platform  ◀──  app, cli, mcp
                ▲
                └──────────  workbench (UI)
```

| Package | May import |
| --- | --- |
| `base` | nothing (plain TypeScript) |
| `contracts` | `base`, zod |
| `platform` | `base`, `contracts` |
| `workbench` | `base`, `contracts`, `design` (never `platform`: the UI reaches services only through `window.orch`) |
| `app` | everything below it |
| `cli`, `mcp` | `base`, `contracts`, and the channel client from `platform/channels/common` |

Nothing imports `app`, `cli` or `mcp`.

## Environments: what each folder may use

Inside every package, code is sorted by where it runs, exactly as in VS Code. A file may only import from its own environment or one allowed below it.

| Folder | Can use | May import from |
| --- | --- | --- |
| `common` | Plain JavaScript only | `common` |
| `browser` | DOM, React | `common`, `browser` |
| `node` | Node.js APIs | `common`, `node` |
| `electron-preload` | `contextBridge`, `ipcRenderer` | `common` |
| `electron-utility` | Electron utility-process APIs | `common`, `node` |
| `electron-main` | Electron main-process APIs | `common`, `node`, `electron-utility` |

Each environment has its own `tsconfig` with only the matching type libraries (`common` sees neither DOM nor Node types), so a wrong import fails type-checking before lint even runs.

## Services

Every capability is a service: an **interface** in `contracts`, an **id**, and one **implementation** in `platform/<service>/node`.

```ts
// platform/src/quota/common/quota.ts
import { createServiceId } from '@orch/base';
import type { IQuotaService } from '@orch/contracts';
export const IQuotaService = createServiceId<IQuotaService>('quota');

// platform/src/quota/node/quotaService.ts
export class QuotaService implements IQuotaService {
  constructor(
    private readonly accounts: IAccountsService,   // injected
    private readonly store: IStoreService,         // injected
  ) {}
  …
}

// app/src/electron-utility/coreHost.ts
services.register(IQuotaService, QuotaService, [IAccountsService, IStoreService]);
```

Rules:

- Dependencies arrive through the constructor, never through imports of another service's implementation. This keeps every service testable with fakes.
- We use a small hand-written service collection (`base/src/common/services.ts`) with explicit dependency lists instead of VS Code's decorators, so no `reflect-metadata` or experimental decorators.
- A service that only one feature uses lives inside that feature's folder, not in `platform` (VS Code's rule for contrib-only services).

## Channels: one interface, three transports

Clients never call a service directly across processes. `platform/channels` turns any service interface into a proxy that works over:

1. **In-process**: tests and the core host itself.
2. **MessagePort**: the desktop window and the engine host.
3. **JSON-RPC over a local socket**: the orch CLI and orch-mcp.

Every message is validated with the `contracts` zod schemas on both ends. Every method returns `Result<T>`; nothing throws across a boundary. Live updates use one stream of `OrchEvent`s, each carrying the full new object, so stores replace rather than patch.

## The window (workbench)

Modelled on VS Code's workbench:

```text
workbench/src/browser/
  parts/        Shell regions from the design: titlebar, activitybar, sidebar (Work only),
                statusbar, capacity panel, command palette, terminal dock
  contrib/      One folder per area: work, newjob, specs, review, sessions, accounts, trust
    <area>/
      index.ts            The ONLY file other code may import from this area
      <area>.contribution.ts  Registers routes, activity-bar item, palette commands, status items
      components/  stores/  hooks/
  services/     Window-side helpers (the window.orch client, theme, keybindings)
  workbench.main.ts  Imports every *.contribution.ts
```

Rules, from VS Code's contrib conventions:

- Nothing outside `contrib/` imports from `contrib/`.
- A contrib area exposes its public API from `index.ts` only, and never reaches into another area's internals.
- Every area registers itself from one `.contribution.ts` file, loaded by `workbench.main.ts`.

Stores are small Zustand stores per area, fed by `OrchEvent`s, with selective subscriptions so a busy agent pane doesn't re-render the whole window (an Orca performance practice). All styling uses CSS modules and `design/tokens/tokens.css`; see `design/DESIGN_RULES.md`.

## The preload bridge

Following Orca and Electron security guidance: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The preload exposes exactly one object:

```ts
window.orch = {
  connect(): Promise<MessagePort>,  // port to the core host
  app: { version, os, openExternal(url), showItemInFolder(path), onUpdateReady(cb) },
}
```

No other Node or Electron API reaches the window.

## Platform services

| Service folder | Owns |
| --- | --- |
| `config` | `accounts.yaml`: read, validate, write, watch |
| `profiles` | Account folders, shared-skills links, building each session's env. The only code that reads or writes account env variables |
| `adapters` | One file per agent implementing `AgentAdapter`. The only code that knows agent folders, logins and output formats |
| `engine` | `node/engineHost.ts` (runs Claw) and `common/engineClient.ts` (talks to it). The only code that imports Claw |
| `quota` | Usage windows, picking accounts, limit events |
| `jobs`, `runs`, `sessions` | Job lifecycle on top of engine workflows and sessions |
| `git` | Worktrees, diffs, merges (git CLI via execa) |
| `review` | Verdicts, merge gate, corrections |
| `trust` | Track records, ladder, gardener schedule |
| `shells` | PTY host client and host |
| `doctor` | Install, login, isolation and skills checks |
| `specs` | Spec files, queue state machine and scheduler (`docs/specs/spec-queue.md`) |
| `store` | SQLite + migrations |
| `channels` | Proxies and transports |

## How to add…

**An agent:** implement `AgentAdapter` in `platform/src/adapters/node/<agent>.ts`; add recorded output to `platform/test/fixtures/<agent>/`; add the agent to `AgentId` in contracts (a contract change); add doctor isolation tests. Nothing else changes.

**A screen:** add it to the design canvas first; then create `workbench/src/browser/contrib/<area>/` with `index.ts` and `<area>.contribution.ts`; add its visual test.

**A service method or event:** change `contracts` (approval required), implement it in `platform`, then use it.

## Enforcement

| Rule | Tool |
| --- | --- |
| Package layers and environments | dependency-cruiser (`tools/depcruise.cjs`) |
| Contrib internals, Node-only modules, `process.env` | ESLint (`tools/eslint.architecture.mjs`) |
| Environment type libraries | One `tsconfig` per environment |
| Contracts unchanged without approval | Protected files (orch guardrail) + CODEOWNERS |
| Design | `design/lint`, visual tests |
