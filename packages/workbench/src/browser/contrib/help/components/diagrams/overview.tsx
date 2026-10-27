import { Figure, Lane, Node, Chip, Arrow, AgentBadge } from './kit.js';

export function OverviewDiagram() {
  return (
    <Figure
      title="How orch fits together"
      label="How orch fits together: the orch window connects via MessagePort and the CLI via local socket to the core host, which coordinates Claw Orchestrator and PTY terminals to run Claude Code, Codex, Gemini CLI, OpenCode, and Antigravity in isolated git worktrees through checks, audit, and review before merging into your branch."
    >
      <Lane title="You and the app">
        <div className="flex gap-3 flex-row items-center justify-between w-full min-w-0">
          <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
            <Node icon="users" title="You" className="shrink-0" />
            <Arrow direction="horizontal" />
            <Node
              icon="monitor"
              title="orch window"
              className="flex-1 min-w-[240px]"
              chips={[
                <Chip key="work">Work</Chip>,
                <Chip key="specs">Specs</Chip>,
                <Chip key="review">Review</Chip>,
                <Chip key="sessions">Sessions</Chip>,
                <Chip key="trust">Trust</Chip>,
                <Chip key="accounts">Accounts</Chip>,
              ]}
            />
          </div>
          <Node
            icon="terminal"
            title="orch CLI · orch-mcp"
            className="shrink-0 w-[170px]"
          />
        </div>
      </Lane>

      <div className="flex items-center justify-between px-6 w-full min-w-0">
        <div className="flex flex-1 justify-center">
          <Arrow direction="vertical" label="MessagePort" />
        </div>
        <div className="flex shrink-0 justify-center w-[170px]">
          <Arrow direction="vertical" label="local socket" />
        </div>
      </div>

      <Lane title="Inside orch">
        <div className="flex gap-3 flex-row items-center justify-between w-full min-w-0">
          <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
            <Node
              icon="layers"
              title="Core host"
              className="flex-1 min-w-[240px]"
              chips={[
                <Chip key="acct">accounts & routing</Chip>,
                <Chip key="jobs">jobs & runs</Chip>,
                <Chip key="queue">spec queue</Chip>,
                <Chip key="checks">review & checks</Chip>,
                <Chip key="sess">sessions</Chip>,
                <Chip key="trust">trust</Chip>,
              ]}
            />
            <Arrow direction="horizontal" />
            <Node
              icon="robot"
              title="Engine host"
              subtitle="Claw Orchestrator"
              className="shrink-0"
            />
          </div>
          <Node
            icon="terminal"
            title="PTY host · terminals"
            className="shrink-0 w-[170px]"
          />
        </div>
      </Lane>

      <div className="flex justify-center w-full min-w-0">
        <Arrow
          direction="vertical"
          label="starts each agent with its account's profile"
        />
      </div>

      <Lane title="Where the work happens">
        <div className="flex flex-col gap-2 w-full min-w-0">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs font-semibold text-text">Agent CLIs:</span>
            <AgentBadge tone="cc" />
            <AgentBadge tone="cx" />
            <AgentBadge tone="gm" />
            <AgentBadge tone="oc" />
            <AgentBadge tone="ag" />
          </div>

          <div className="flex pl-6">
            <Arrow direction="vertical" />
          </div>

          <div className="flex w-full min-w-0 items-center justify-between gap-1">
            <Node
              icon="branch"
              title="Git worktrees · .orch/wt, one per run"
              className="flex-1 min-w-0 p-2"
            />
            <Arrow direction="horizontal" className="shrink-0" />
            <Node icon="shield" title="Checks & audit" className="shrink-0 p-2" />
            <Arrow direction="horizontal" className="shrink-0" />
            <Node icon="review" title="Review" className="shrink-0 p-2" />
            <Arrow direction="horizontal" className="shrink-0" />
            <Node icon="merge" title="Merge into your branch" className="shrink-0 p-2" />
          </div>
        </div>
      </Lane>
    </Figure>
  );
}
