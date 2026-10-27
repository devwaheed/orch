/**
 * Council mode panel: select 2–5 members and maximum rounds (3, 5, 8).
 * Follows design/prototype/Main.dc.html lines 816–837.
 */
import type { AgentId, AgentInfo } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { COUNCIL_ROUNDS_OPTIONS } from '../newJobModel.js';
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

export interface CouncilPanelProps {
  readonly agents: readonly AgentInfo[];
  readonly selectedAgents: readonly AgentId[];
  readonly rounds: number;
}

export function CouncilPanel({ agents, selectedAgents, rounds }: CouncilPanelProps) {
  return (
    <section aria-labelledby="cn-h" className="flex flex-col gap-4">
      <h2 id="cn-h" className="m-0 text-md font-semibold">
        {newJobStrings.council.heading}
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
              onClick={() => useNewJobDraft.getState().toggleCouncilMember(agent.id)}
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
      <div className="flex flex-wrap items-center gap-4 text-base">
        <span className="text-text2">{newJobStrings.council.roundsLabel}</span>
        <div role="group" aria-label={newJobStrings.council.roundsGroupLabel} className="flex p-3px rounded-9px bg-panel2 border border-line">
          {COUNCIL_ROUNDS_OPTIONS.map((n) => {
            const pressed = rounds === n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={pressed}
                onClick={() => useNewJobDraft.getState().setCouncilRounds(n)}
                className={cls(
                  'px-5 py-2 min-h-[30px] rounded-sm border-0 text-sm cursor-pointer',
                  pressed ? 'bg-seg text-text' : 'bg-transparent text-muted',
                  FOCUS_RING,
                )}
              >
                {newJobStrings.council.roundOption(n)}
              </button>
            );
          })}
        </div>
        <span className="text-muted2 text-sm">{newJobStrings.council.roundsSubtext}</span>
      </div>
    </section>
  );
}
