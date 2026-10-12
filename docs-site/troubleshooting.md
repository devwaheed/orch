# Troubleshooting

## Run doctor

Run `orch doctor` to check the system, agents, engine, and profiles. If it reports a problem, follow its **Fix** instruction and run the check again. To also check account isolation, run `orch doctor --sign-in-twice`; this signs in twice per agent.

## Send a bug report

Choose **Report a problem…** in the Help menu or the command palette, or run `orch bug-report`. orch saves a zip on your computer, in `~/.orch/bug-reports/` (or the folder you pass with `--out`). Nothing is sent anywhere. After saving, you can show it in its folder or open a GitHub issue with your version and OS filled in, then attach the zip.

The zip contains, exactly: `versions.json`, `doctor.json`, the last 3 days of logs, `accounts.yaml` with emails masked, and `specs.yaml` if you have one. It never contains transcripts, repository contents, tokens, environment values or profile folders. Bundles older than 30 days are deleted when orch starts.

If the engine keeps stopping, orch shows a bar with **Restart engine** and **Report a problem**.

## Uninstall

Run `orch uninstall` and confirm. This removes `~/.orch/`. It does not remove repositories, worktrees outside `~/.orch/`, or the agents' own folders. `orch uninstall --yes` skips the confirmation.

<!-- Source: LOCKED SEC-03, SEC-05, CLI-01, BUG-01…BUG-04, ENG-07; packages/cli/src/node/cli.ts, packages/cli/src/node/bugreport/bugreport.ts, packages/platform/src/doctor/common/strings.ts -->
