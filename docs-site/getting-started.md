# Getting started

## Install orch

orch is an Electron desktop app for macOS 13 or later, Windows 11 x64, and Linux x64 (Ubuntu 22.04+ or Fedora 39+). The app includes the `orch` command.

<!-- TBD: Download URL and release repository have not been decided. -->
<!-- TBD: How to install the separately published npm CLI has not been specified. -->

## Choose a project folder

Open a repository as your project. orch creates a separate git worktree for each run, under `.orch/wt/` in the repository. It adds `.orch/` to `.git/info/exclude` and does not edit `.gitignore`.

## Add an account

Open **Accounts**, choose **Add account**, select an agent, name the account, then sign in on that agent's sign-in page. orch checks that the account is signed in, kept separate, and ready. See [Accounts](accounts.md).

Supported agents are Claude Code, Codex, Gemini CLI, OpenCode, and Antigravity (experimental). You need an account with the agent to sign in.

## Start your first job

Choose **New job**, enter a goal, select a mode, review the checks and limit policy, then start the job. See [Jobs](jobs.md).

<!-- Source: LOCKED PRD-02, PRD-03, PRD-05, JOB-02, ACC-04; design/screens.md: shell, Accounts, Add account, Start a job -->
