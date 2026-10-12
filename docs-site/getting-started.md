# Getting started

## Install orch

orch is a desktop app for macOS 13 or later, Windows 11 x64, and Linux x64 (Ubuntu 22.04+ or Fedora 39+). Install it with the installer for your system: `.dmg` (macOS), `.exe` (Windows), `.deb` or AppImage (Linux). orch is not published to npm.

<!-- TBD: Download URL and release repository have not been decided. -->

## The orch command

The `orch` command is part of the app:

- **Windows:** the installer adds it to your PATH. The uninstaller removes it.
- **Linux (.deb):** the package installs `/usr/bin/orch`.
- **macOS:** choose **Install orch command** when orch offers it after the first-launch check, or from the command palette or the orch menu. It creates `/usr/local/bin/orch` and may ask for an admin password. **Uninstall orch command** removes it.
- **Linux (AppImage):** choose **Install orch command**. It creates `~/.local/bin/orch`. If `~/.local/bin` isn't on your PATH, orch shows the line to add.

`orch doctor` warns when `orch` isn't on your PATH and tells you how to fix it.

## Choose a project folder

Open a repository as your project. orch creates a separate git worktree for each run, under `.orch/wt/` in the repository. It adds `.orch/` to `.git/info/exclude` and does not edit `.gitignore`.

## Add an account

Open **Accounts**, choose **Add account**, select an agent, name the account, then sign in on that agent's sign-in page. orch checks that the account is signed in, kept separate, and ready. See [Accounts](accounts.md).

Supported agents are Claude Code, Codex, Gemini CLI, OpenCode, and Antigravity (experimental). You need an account with the agent to sign in.

## Start your first job

Choose **New job**, enter a goal, select a mode, review the checks and limit policy, then start the job. See [Jobs](jobs.md).

<!-- Source: LOCKED PRD-02, PRD-03, PRD-05, JOB-02, ACC-04; design/screens.md: shell, Accounts, Add account, Start a job -->
