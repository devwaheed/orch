# Troubleshooting

## Run doctor

Run `orch doctor` to check the system, agents, engine, and profiles. If it reports a problem, follow its **Fix** instruction and run the check again. To also check account isolation, run `orch doctor --sign-in-twice`; this signs in twice per agent.

## Send a bug report

<!-- TBD: How to create and attach a bug-report bundle is not exposed as a CLI command yet; the available flow is not specified. -->

The bundle implementation collects logs and doctor output and redacts tokens, keys, email addresses, and environment values. Logs are kept under `~/.orch/logs/` for 14 days.

## Uninstall

Run `orch uninstall` and confirm. This removes `~/.orch/`. It does not remove repositories, worktrees outside `~/.orch/`, or the agents' own folders. `orch uninstall --yes` skips the confirmation.

<!-- Source: LOCKED SEC-03, SEC-05, CLI-01; packages/cli/src/node/cli.ts, packages/cli/src/node/bugreport/bugreport.ts, packages/platform/src/doctor/common/strings.ts -->
