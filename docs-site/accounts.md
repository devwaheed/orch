# Accounts

An account is one sign-in for an agent. orch keeps each account's agent data in a separate private folder. Sign-in happens through the agent's own sign-in flow; orch never reads, copies, or stores credentials. Email addresses are masked in orch.

## Add an account

In **Accounts**, choose **Add account**. Select the agent, give the account a name, and choose **Open sign-in**. Complete sign-in with the agent. orch checks **Signed in**, **Kept separate**, and **Ready** before you finish.

The first account added for an agent becomes its primary account. Each agent has one primary. You can switch an account off with **Use**; switched-off accounts are not picked for work. Removing an account asks for confirmation and deletes only its orch profile folder.

Several accounts can be used at once for Claude Code, Codex, and Gemini CLI on all supported operating systems; OpenCode on macOS and Linux; and Antigravity on Linux. OpenCode on Windows is unverified. Antigravity allows one account on macOS and Windows. These limits depend on the operating system.

## Account routing

**Primary first** uses the primary until it is near its limit, then chooses the backup account with the lowest usage. **Most headroom** always chooses the account with the lowest usage. Ties go to the older account. Signed-out, limited, or switched-off accounts are skipped. An account at the active-run limit is also skipped.

<!-- Source: LOCKED ACC-01, ACC-03, ACC-04, ACC-05, ACC-06, ACC-07, ACC-08; design/screens.md: Accounts and Add account -->
