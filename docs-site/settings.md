# Settings

The Settings screen configures application appearance, routing policies, engine diagnostics, command line tools, and application information.

![Settings screen](images/settings.jpg)

## What you see

- **Left navigation**: anchor links jump directly to any section: **General**, **Accounts and routing**, **Engine**, **Command line**, and **About**.
- **General**:
  - **Theme**: choose **System**, **Light**, or **Dark**. Syncs with system appearance or saves your explicit choice.
  - **Menu side**: place the activity bar on the **Left** or **Right** edge of the window.
- **Accounts and routing**:
  - **Manage accounts**: navigates directly to the Accounts screen ([accounts.md](accounts.md)).
  - **Routing**: choose how orch picks an account:
    - **Primary first**: use the primary account until it nears its limit, then the next.
    - **Most headroom**: always pick the account with the most capacity left.
  - **File settings**: read-only configuration values (**Max runs per account**, **Near limit at**, and **Share skills**) with helper text `Change these in ~/.orch/accounts.yaml.` and a **Show file** button.
- **Engine**:
  - **Engine status**: displays whether the engine is **Healthy** or **Not healthy**.
  - **Restart engine**: restart the engine process.
  - **Doctor checks**: run machine diagnostics via **Run checks** and view passing (✓) and failing (✗) checks along with actionable fixes.
- **Command line**:
  - **PATH status**: confirms whether `orch` is installed on your system PATH.
  - **Install orch command**: installs or updates the `orch` command for your shell.
- **About**:
  - Displays **orch version** and engine version (**Engine: Claw Orchestrator 7.5.6**).
  - **Show logs**: reveals the log directory (`~/.orch/logs`) in your file manager.
  - **Report a problem**: opens the bug report dialog.
