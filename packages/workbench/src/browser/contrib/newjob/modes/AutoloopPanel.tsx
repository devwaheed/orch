/**
 * Autoloop mode panel: select agents for Planner, Coder, and Reviewer roles.
 * Follows design/prototype/Main.dc.html lines 839–858.
 */
import type { AgentId, AgentInfo } from '@orchagents/contracts';
import { AUTOLOOP_ROLES } from '../newJobModel.js';
import { useNewJobDraft } from '../stores/newJobStore.js';
import { newJobStrings } from '../strings.js';

function cls(...names: ReadonlyArray<string | false | null | undefined>): string {
  return names.filter((name): name is string => typeof name === 'string' && name !== '').join(' ');
}

const AGENT_BADGE: Record<AgentId, { mono: string; className: string }> = {
  claude: { mono: 'CC', className: 'bg-cc-bg text-cc-fg' },
  codex: { mono: 'CX', className: 'bg-cx-bg text-cx-fg' },
  agy: { mono: 'AG', className: 'bg-ag-bg text-ag-fg' },
  gemini: { mono: 'GM', className: 'bg-gm-bg text-gm-fg' },
  opencode: { mono: 'OC', className: 'bg-oc-bg text-oc-fg' },
};

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2';
const BADGE_TILE = 'flex shrink-0 basis-[26px] h-[26px] rounded-7px font-mono text-9p5 font-semibold items-center justify-center';

export interface AutoloopPanelProps {
  readonly agents: readonly AgentInfo[];
  readonly roles: {
    readonly planner: AgentId;
    readonly coder: AgentId;
    readonly reviewer: AgentId;
  };
}

export function AutoloopPanel({ agents, roles }: AutoloopPanelProps) {
  return (
    <section aria-labelledby="lp-h" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2px">
        <h2 id="lp-h" className="m-0 text-md font-semibold">
          {newJobStrings.autoloop.heading}
        </h2>
        <p className="m-0 text-muted2 text-sm">{newJobStrings.autoloop.intro}</p>
      </div>
      {AUTOLOOP_ROLES.map(({ role }) => {
        const copy = newJobStrings.autoloop.roles[role];
        const assignedAgent = roles[role];
        return (
          <div key={role} className="flex flex-wrap items-center gap-4 px-5 py-4 border border-line rounded-lg bg-panel">
            <div className="flex shrink-0 basis-[110px] flex-col">
              <span className="font-semibold text-base">{copy.label}</span>
              <span className="text-muted2 text-xs">{copy.desc}</span>
            </div>
            <div role="radiogroup" aria-label={copy.aria} className="flex flex-wrap gap-2">
              {agents.map((agent) => {
                const checked = assignedAgent === agent.id;
                const badge = AGENT_BADGE[agent.id];
                const shortName = agent.displayName.split(' ')[0] ?? agent.displayName;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => useNewJobDraft.getState().setRole(role, agent.id)}
                    title={agent.displayName}
                    className={cls(
                      'flex items-center gap-7px py-5px pl-5px pr-4 min-h-[36px] rounded-md text-text text-sm cursor-pointer',
                      checked ? 'border-2 border-accent bg-sel' : 'border border-line bg-transparent',
                      FOCUS_RING,
                    )}
                  >
                    <span className={cls(BADGE_TILE, badge.className)}>{badge.mono}</span>
                    <span>{shortName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
