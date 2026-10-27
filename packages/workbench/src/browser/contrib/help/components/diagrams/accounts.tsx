import { Figure, Node, Chip, Arrow, FanOut } from './kit.js';

export function AccountsDiagram() {
  return (
    <Figure
      title="Accounts and routing"
      label="Accounts and routing: Claude Code fans out to Personal, Work, and Team accounts with private profile directories, sharing a common skills folder, while the router chooses an account by priority or headroom and the Capacity panel monitors rate limits."
    >
      <div className="flex w-full min-w-0 justify-center">
        <div className="inline-flex items-center gap-2 rounded-md border border-line bg-panel p-3">
          <span className="rounded-xs px-1 font-mono text-xs font-semibold bg-cc-bg text-cc-fg">
            CC
          </span>
          <span className="text-xs font-semibold text-text">Claude Code</span>
        </div>
      </div>

      <FanOut />

      <div className="grid grid-cols-3 gap-3 w-full min-w-0 box-border">
        <div className="flex w-full min-w-0 box-border flex-col gap-1 rounded-md border border-line bg-panel p-3">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-semibold text-text">Personal</span>
            <Chip className="font-semibold text-text">Primary</Chip>
          </div>
          <span className="mt-1 break-all font-mono text-xs text-muted">
            ~/.orch/profiles/claude-personal
          </span>
        </div>

        <div className="flex w-full min-w-0 box-border flex-col gap-1 rounded-md border border-line bg-panel p-3">
          <span className="text-xs font-semibold text-text">Work</span>
          <span className="mt-1 break-all font-mono text-xs text-muted">
            ~/.orch/profiles/claude-work
          </span>
        </div>

        <div className="flex w-full min-w-0 box-border flex-col gap-1 rounded-md border border-line bg-panel p-3">
          <span className="text-xs font-semibold text-text">Team</span>
          <span className="mt-1 break-all font-mono text-xs text-muted">
            ~/.orch/profiles/claude-team
          </span>
        </div>
      </div>

      <Node
        icon="folder"
        title="Shared skills folder: every account of the agent sees it (e.g. saas-factory)"
        className="w-full min-w-0 box-border"
      />

      <div className="flex justify-center">
        <Arrow direction="vertical" />
      </div>

      <Node
        icon="swap"
        title="Router picks the account for each run"
        chips={[
          <Chip key="primary">Primary first</Chip>,
          <Chip key="headroom">Most headroom</Chip>,
        ]}
        className="w-full min-w-0 box-border"
      />

      <div className="flex justify-center">
        <Arrow direction="vertical" />
      </div>

      <Node
        icon="gauge"
        title="Capacity panel shows each account's limits"
        className="w-full min-w-0 box-border"
      />

      <div className="border-t border-line pt-2 text-center font-mono text-xs text-muted w-full min-w-0 box-border">
        profile variables CLAUDE_CONFIG_DIR · CODEX_HOME · GEMINI_CLI_HOME · XDG_DATA_HOME + OPENCODE_CONFIG_DIR
      </div>
    </Figure>
  );
}
