# orch: repository starter

The foundation agents build on. Copy into the new repo, then add the design handoff as `design/`.

| Path | What it is |
| --- | --- |
| `AGENTS.md` | Instructions every agent reads before every task |
| `docs/architecture.md` | Code architecture (VS Code-style layers, Orca-style Electron split) |
| `docs/contracts.md` | What the contracts define and how to change them |
| `docs/decisions/LOCKED.md` | Every product and technical value, decided in advance |
| `docs/specs/` | Locked feature specs (spec queue) and the spec file template |
| `docs/adr/` | Ten decision records |
| `docs/backlog/` | Stories for every phase, 0 to 5 |
| `design/` | The design handoff: tokens, icons, design lint, visual tests, prototype |
| `packages/contracts/` | The shared types and schemas: type-checked under strict settings, with tests |
| `tools/depcruise.cjs` | Layer and environment rules (dependency-cruiser) |
| `tools/eslint.architecture.mjs` | Rules dependency-cruiser can't express |

Start with `docs/backlog/phase-0-spike.md`. Story S1-01 wires these tools into a full pnpm workspace.

Verify the contracts: `cd packages/contracts && npm install && npm run typecheck && npm test`.
