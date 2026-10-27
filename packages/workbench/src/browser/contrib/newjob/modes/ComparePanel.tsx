/**
 * Compare mode panel: select 2–5 agents to run side-by-side, with optional
 * combine step. Follows design/prototype/Main.dc.html lines 798–814.
 */
import type { AgentId, AgentInfo } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
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

export interface ComparePanelProps {
  readonly agents: readonly AgentInfo[];
  readonly selectedAgents: readonly AgentId[];
  readonly combine: boolean;
}

export function ComparePanel({ agents, selectedAgents, combine }: ComparePanelProps) {
  return (
    <section aria-labelledby="cmp-h" className="flex flex-col gap-4">
      <h2 id="cmp-h" className="m-0 text-md font-semibold">
        {newJobStrings.compare.heading}
      </h2>
      <div className="flex flex-wrap gap-3">
        {agents.map((agent) => {
          const selected = selectedAgents.includes(agent.id);
          const badge = AGENT_BADGE[agent.id];
          return (
            <button
              key={agent.id}
              type="button"
              aria-pressed={selected}
              onClick={() => useNewJobDraft.getState().toggleCompareAgent(agent.id)}
              className={cls(
                'flex items-center gap-9px pl-3 pr-5 py-3 min-h-[44px] rounded-lg text-text text-base cursor-pointer',
                selected ? 'border-2 border-accent bg-sel' : 'border border-line bg-panel',
                FOCUS_RING,
              )}
            >
              <span className={cls(BADGE_TILE, badge.className)}>{badge.mono}</span>
              <span>{agent.displayName}</span>
              {selected ? <Icon name="check" size={13} className="text-accent ml-1" /> : null}
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-4 px-5 py-4 border border-line rounded-lg bg-panel cursor-pointer text-base">
        <input
          type="checkbox"
          checked={combine}
          onChange={(e) => useNewJobDraft.getState().setCombine(e.target.checked)}
          className={`w-[17px] h-[17px] accent-accent ${FOCUS_RING}`}
        />
        <span className="flex flex-col gap-1">
          <span className="font-medium">{newJobStrings.compare.combineLabel}</span>
          <span className="text-muted2 text-xs">{newJobStrings.compare.combineDesc}</span>
        </span>
      </label>
    </section>
  );
}
