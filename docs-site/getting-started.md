# Getting started

Get started with orch by installing the desktop app, setting up the command line, connecting an agent account, and running your first job.

![Specs queue screen](images/specs-queue.jpg)

## Finding your way around

![The Title bar with repository name, command palette, notifications, help, theme toggle, capacity toggle, and New spec](images/titlebar.jpg)

- **Title bar**: shows the active git repository folder name, command palette search bar (`Search runs, sessions, or run a command` or ⌘K), notifications, help, theme switcher, capacity panel toggle, and the **New spec** button. Open the bell to see the newest 50 in-app notifications; opening marks them read. Select a notification to open the related area, or choose **Clear** to remove the list.

![The Activity bar with Specs, Review, Sessions, Trust, Accounts, and Settings](images/activitybar.jpg)

- **Activity bar**: navigates between primary areas (**Specs**, **Review**, **Sessions**), configuration areas (**Trust**, **Accounts**), and Settings at the bottom. Badges show specs that need you, ready review items, and signed-out accounts. Sessions has no badge.

![The Status bar with engine status, branch, terminal toggle, active runs, limited accounts, and palette shortcut](images/statusbar.jpg)

- **Status bar**: shows engine status (`orchd`), current git branch, a toggle for the **Terminal** dock, active run counts, limited account alerts, signed out accounts count, and the command palette shortcut (⌘K). The terminal dock is available in every area; it stays open as you switch areas.

## How to install orch

orch is available as a desktop application for macOS 13 or later (Apple silicon and Intel), Windows 11 x64, and Linux x64 (Ubuntu 22.04+ and Fedora 39+).

1. Download the installer package for your operating system:
   - macOS: `.dmg`
   - Windows: `.exe`
   - Linux: `.deb` or `.AppImage`
2. Run the installer and launch orch.

> orch is not published to npm. The desktop app contains all necessary binaries, including the core host, engine host, and CLI tools.

## How to install the orch command

The `orch` command lets you launch jobs, inspect runs, and check system health from any terminal:

- **Windows**: the installer automatically adds the executable directory to your PATH.
- **Linux (.deb)**: the package installs `/usr/bin/orch`.
- **macOS**: after your first launch check, orch displays a dialog asking **Use orch from your terminal?**. Click **Install orch command** to create the `/usr/local/bin/orch` symlink. You can also run **Install orch command** anytime from the command palette (⌘K).
- **Linux AppImage**: choose **Install orch command** from the command palette (⌘K) to create a wrapper script at `~/.local/bin/orch`.

## How to open a project

1. Click the project folder button in the title bar, or run `orch <path>` in your terminal.
2. Select any local folder inside a git repository.
3. orch detects the git root and opens the project.

## How to add your first account

orch requires at least one signed-in agent account to run jobs:

1. Click **Accounts** in the activity bar (or press ⌘5 on macOS, Ctrl+5 elsewhere).
2. Click **Add account**.
3. Choose an agent: **Claude Code**, **Codex**, **Gemini CLI**, **OpenCode**, or **Antigravity**.
4. Enter an account **Name** (such as `Work` or `Personal`).
5. Click **Sign in**. The agent's native login flow runs inside the dialog.
6. Complete sign-in in your browser or terminal. If the agent CLI remains open after signing in, click **I’m signed in**.
7. orch verifies three checks: **Signed in**, **Kept separate**, and **Ready**.
8. Click **Done**. The first account you add for an agent becomes its **Primary** account.

See [accounts.md](accounts.md) for details on routing, multiple accounts, and shared skills.

## How to add your first spec

1. Click **New spec** in the title bar (or press ⌘N on macOS, Ctrl+N elsewhere).
2. Enter a title in the **Title** field and details in **What to do**.
3. Keep the default mode: **One job, split up**.
4. Leave the orchestrator set to **Auto** so orch picks an account with headroom.
5. Review the automated done-when checks and always-on guardrails.
6. Click **Add spec**.
7. orch writes the spec and switches to the **Specs** queue ([specs.md](specs.md)) automatically so you can watch the spec run in the queue and Live view.

## Good to know

- You can check your system configuration and installed agents at any time by running `orch doctor` in your terminal.
- Each run works on an independent git branch and worktree under `.orch/wt/`. Your main checkout remains clean and untouched until you approve changes in [review.md](review.md).
