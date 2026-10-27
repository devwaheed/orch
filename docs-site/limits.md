# Capacity and limits

The Capacity panel monitors real-time agent headroom, displays reported and estimated quota windows, tracks daily API spend, and coordinates limit pauses.

![Capacity panel](images/capacity.jpg)

## What you see

Toggle the Capacity panel by clicking the capacity toggle in the title bar or status bar, or press ⌘B on macOS (Ctrl+B elsewhere).

- **Header**: displays **Capacity · live usage**, the number of usable accounts (`X/Y usable`), and a quick link to **Account settings** ([accounts.md](accounts.md)).
- **Account cards**:
  - Shows each account's name, agent badge, and active task count (`N runs`).
  - State pills: **Available**, **Available · est.**, **Near limit**, **Limited**, or **Signed out**.
  - **Usage bars**: visual progress bars showing consumption across time windows (such as 5-hour, daily, or weekly windows).
  - Limited accounts display their expected return time: `Limited until <time>`.
- **Legend**:
  - Solid bars indicate **reported** usage windows provided directly by the agent CLI.
  - Striped bars indicate **estimated** usage windows calculated by orch.
- **Spend today**:
  - Displays total expenditure for the day across accounts using API keys (`run ledger · API keys only`).

## Reported vs estimated usage

orch never calls external provider APIs or scrapes provider websites. Usage data is learned entirely from agent CLI output and rate limit errors:

- **Reported windows**: some agents (such as Claude Code) report exact usage windows in their output. orch parses these windows and renders them as solid bars.
- **Estimated windows**: for agents that do not report usage metrics, orch displays "Usage" as unknown until an account encounters a rate limit error. When a limit hits, orch records the total requests completed and calculates future capacity as requests completed since the last reset divided by the learned limit. Estimated bars are displayed with striped styling.
- **Data freshness**: usage windows older than 6 hours display their age (such as `seen 7 h ago`) and are treated as 0% used when orch makes automated routing decisions.

## What happens when an account hits a limit

When an account exhausts its rate limit mid-run:

1. **Automatic pause**: orch pauses the run and sets its status pill to **Paused · limit** in [work.md](work.md).
2. **State preserved**: the git worktree, terminal transcript, and agent session are saved without data loss.
3. **Limit policy applies**: orch follows the policy selected when starting the job ([new-job.md](new-job.md)):
   - **Switch account** (default): moves execution to another account belonging to the same agent.
   - **Switch agent**: hands the task off to another agent in your worker pool.
   - **Ask me**: keeps the run paused and notifies you.
4. **Resuming**:
   - Click **Resume now on [agent] · [account]** in [work.md](work.md) to hand off to an available backup immediately.
   - Leave the auto-resume option checked to resume automatically at the reset time plus a random delay of 0–120 seconds.
   - Choose **More resume options** to open the session in [sessions.md](sessions.md).

## Spend today

The **Spend today** card aggregates daily token expenditures from the local run ledger:

- Calculates token costs for accounts authenticated via API keys.
- Accounts that use flat-rate subscriptions (such as Claude Pro or ChatGPT Plus) do not incur variable token charges.
