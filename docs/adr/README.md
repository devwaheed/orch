# Architecture decision records

Short records of why big choices were made, so they aren't quietly undone. Agents must not edit these; propose a new ADR instead.

| ADR | Decision |
| --- | --- |
| [0001](0001-build-on-claw-hidden.md) | Build on Claw Orchestrator, hidden inside orch |
| [0002](0002-desktop-app-electron.md) | Desktop app with Electron, CLI included |
| [0003](0003-multi-account-profile-folders.md) | Multiple accounts through per-account profile folders |
| [0004](0004-share-agent-skills-no-library.md) | Share each agent's own skills folder; no skills library |
| [0005](0005-vscode-style-layers.md) | VS Code-style layers, environments, services and contributions |
| [0006](0006-utility-process-hosts.md) | Core, engine and terminals in separate utility processes |
| [0007](0007-one-contract-three-transports.md) | One contract, three transports |
| [0008](0008-verification-by-orch.md) | Verification by orch, never by the agent |
| [0009](0009-design-handoff-source-of-truth.md) | Design handoff as the UI's source of truth |
| [0010](0010-spec-queue.md) | An ordered spec queue that moves on by itself |
| [0011](0011-claw-pin-env-patch-compare.md) | Claw 7.5.6 with a per-session env patch; compare runs on fanout |

To change a decision, add a new ADR that supersedes the old one, and mark the old one "Superseded by ADR NNNN".
