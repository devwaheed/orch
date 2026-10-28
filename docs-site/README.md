# orch user guide

orch is a desktop app and command line for running, verifying, and reviewing coding agents across isolated accounts and git worktrees.

1. [How orch fits together](how-it-fits.md)
2. [Getting started](getting-started.md)
3. [Specs](specs.md)
4. [New spec](new-spec.md)
5. [SaaS Factory](saas-factory.md)
6. [Review](review.md)
7. [Sessions](sessions.md)
8. [Trust](trust.md)
9. [Accounts](accounts.md)
10. [Capacity and limits](limits.md)
11. [Command line and MCP](cli.md)
12. [Keyboard shortcuts](shortcuts.md)
13. [Troubleshooting](troubleshooting.md)
14. [Settings](settings.md)

## Using Help

![In-app help guide displaying documentation for the current screen](images/help.jpg)

Open the live help guide at any time:

- Click the **Help** book button in the title bar.
- Press **F1**.
- Open the command palette (⌘K on macOS, Ctrl+K elsewhere) and choose **Open help**.
- Select **Help → orch guide** from the application menu.

When you open Help, it automatically displays the page for your current screen (such as Specs, New spec, Review, Sessions, Trust, Accounts, or Settings). You can also search all help pages using the search box or navigate between pages using the sidebar and Next/Previous buttons.

## Keeping this guide current

These pages are live docs displayed directly inside the app's Help screen. Any change to what users see must update the matching help page in the same change. Running `pnpm help:shots` regenerates the screenshots from the demo app.
