# Accounts

The Accounts screen manages agent logins in isolated profile folders, configures automatic routing, shares skills across accounts, and syncs settings with YAML configuration.

![Accounts screen](images/accounts.jpg)

[[diagram:accounts]]

## What you see

- **Header**: displays **Accounts** and explains: `Add an account, sign in once, and orch keeps it separate from the others. No folders or environment variables to manage.`
- **View switcher**: toggles between **Visual** mode and the **Config file** view (`~/.orch/accounts.yaml`).
- **Machine check bar**: displays `This machine: <os>` with a **Run check again** button. Confirms that accounts are properly isolated and have access to shared skills.
- **Routing rule** ("How orch picks an account"):
  - **Primary first**: use the primary account until it nears its limit, then the next.
  - **Most headroom**: always pick the account with the most capacity left.
- **Agent sections**:
  - Covers supported agents: **Claude Code**, **Codex**, **Gemini CLI**, **OpenCode**, and **Antigravity**.
  - Displays account totals and availability (`<total> accounts · <usable> usable now`).
  - Shows operating system support status (such as `Several accounts at once` or `One account on macOS`) and config path setting (`via <setting>`).
  - Displays shared skills: `<count> skills (incl. saas-factory) shared with all <name> accounts from <dir>` with a **Share with every account** checkbox.
- **Account cards**:
  - Displays the account name, primary tag, routing role (**Primary · used first**, **Backup · used when the primary is busy**, or **Switched off · never used**), status pill (**Available**, **Available · est.**, **Near limit**, **Limited**, or **Signed out**), and usage window button (e.g. `91% of 5-hour`; clicking it opens the Capacity panel).
  - **Use** checkbox: enable or disable the account from job routing.
  - Action buttons: **Make primary** (star icon), **Sign in** / **Re-login**, and **Remove account** (trash icon).

## Adding an account

Adding an account is a one-screen dialog that executes the agent's native login flow directly inside orch:

![Adding an account on the Accounts screen](images/add-account.jpg)

![Add account dialog showing agent selection, account name, and CLI command](images/add-account-dialog.jpg)

1. Click **Add account** on the Accounts screen.
2. Select an agent under **Which agent is this account for?**.
3. Enter an identifier in the **Name** field (such as `Work`, `Personal`, or `Client`).
4. Enter an optional plan description in the **Type** field (such as `Pro` or `Team`).
5. Click **Sign in**. The agent's native CLI sign-in executes inside the embedded terminal. Your password and credentials never pass through orch.
6. OpenCode free models: if you select OpenCode, click **Use free models** to use free models without logging in, or choose **Sign in to a provider** to add paid credentials.
7. Click **I’m signed in**: if the agent CLI stays open after you authenticate in your browser, click **I’m signed in**.
8. orch runs three automated verification checks:
   - **Signed in**: confirms active authentication and displays your masked email address (e.g. `d•••@domain.com`).
   - **Kept separate**: verifies that the account's credentials and session tokens are isolated in their own private directory (`~/.orch/profiles/<agent>-<slug>/`).
   - **Ready**: confirms usage tracking is on and orch can route work to it.
9. Click **Done**. The first account you add for an agent automatically becomes its **Primary** account.

## Account routing

When adding a spec ([new-spec.md](new-spec.md)) or running specs ([specs.md](specs.md)), orch selects accounts using your chosen routing policy:

- **Primary first**: directs all runs to the primary account until its usage reaches 85% of its window limit. It then routes work to the backup account with the most remaining capacity.
- **Most headroom**: always routes each new run to the account with the lowest percentage of quota used.
- **Tie-breakers**: ties go to the older account.
- **Exclusions**: accounts that are switched off (via the **Use** toggle), currently limited, or signed out are never selected. Accounts at maximum concurrent runs (default 3 active runs) are skipped until a run completes.

## Re-login and removing accounts

- **Re-login**: click **Re-login** on an account card to re-run the agent's sign-in flow. This refreshes expired tokens in that account's existing private folder without altering your routing configuration.
- **Removing an account**: click the remove button and confirm (`Remove <agent> · <name>?`). orch deletes only that account's private profile directory (`~/.orch/profiles/<agent>-<slug>/`). Your other accounts and the agent's global configuration remain untouched. If you remove the primary account, the oldest remaining account becomes primary.

## Shared skills

orch automatically symlinks installed agent skills from your user home directory into each account profile:

- Accounts share access to common tools, including the SaaS Factory skill ([saas-factory.md](saas-factory.md)).
- The Accounts view displays: `<count> skills (incl. saas-factory) shared with all <name> accounts from <dir>`.
- Skills are shared locally without copying files or exposing credentials.
- Use the **Share with every account** checkbox on each agent section to toggle shared skills on or off.

## Config file view

Click **Config file** in the header to view or edit `~/.orch/accounts.yaml`.

- The visual interface and `accounts.yaml` stay synchronized in real time.
- Changes made in the visual editor write directly to `accounts.yaml`.
- Editing `accounts.yaml` in an external editor updates the visual interface immediately.
