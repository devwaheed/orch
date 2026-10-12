/**
 * Council mode panel: select 2–5 members and maximum rounds (3, 5, 8).
 * Follows design/prototype/Main.dc.html lines 816–837.
 */
import type { AgentId, AgentInfo } from '@orchagents/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
import { COUNCIL_ROUNDS_OPTIONS } from '../newJobModel.js';
import { useNewJobDraft } from '../stores/newJobStore.js';
import { newJobStrings } from '../strings.js';
import styles from './modes.module.css';

function cls(...names: ReadonlyArray<string | false | null | undefined>): string {
  return names.filter((name): name is string => typeof name === 'string' && name !== '').join(' ');
}

const AGENT_BADGE: Record<AgentId, { mono: string; className: string }> = {
  claude: { mono: 'CC', className: styles.badgeClaude ?? '' },
  codex: { mono: 'CX', className: styles.badgeCodex ?? '' },
  agy: { mono: 'AG', className: styles.badgeAgy ?? '' },
  gemini: { mono: 'GM', className: styles.badgeGemini ?? '' },
  opencode: { mono: 'OC', className: styles.badgeOpencode ?? '' },
};

export interface CouncilPanelProps {
  readonly agents: readonly AgentInfo[];
  readonly selectedAgents: readonly AgentId[];
  readonly rounds: number;
}

export function CouncilPanel({ agents, selectedAgents, rounds }: CouncilPanelProps) {
  return (
    <section aria-labelledby="cn-h" className={styles.section}>
      <h2 id="cn-h" className={styles.sectionTitle}>
        {newJobStrings.council.heading}
      </h2>
      <div className={styles.agentGrid}>
        {agents.map((agent) => {
          const selected = selectedAgents.includes(agent.id);
          const badge = AGENT_BADGE[agent.id];
          return (
            <button
              key={agent.id}
              type="button"
              aria-pressed={selected}
              onClick={() => useNewJobDraft.getState().toggleCouncilMember(agent.id)}
              className={cls(styles.agentButton, selected && styles.selected)}
            >
              <span className={cls(styles.badge, badge.className)}>{badge.mono}</span>
              <span>{agent.displayName}</span>
              {selected ? <Icon name="check" size={13} className={cls(styles.checkIcon)} /> : null}
            </button>
          );
        })}
      </div>
      <div className={styles.roundsRow}>
        <span className={styles.roundsLabel}>{newJobStrings.council.roundsLabel}</span>
        <div role="group" aria-label={newJobStrings.council.roundsGroupLabel} className={styles.roundsGroup}>
          {COUNCIL_ROUNDS_OPTIONS.map((n) => {
            const pressed = rounds === n;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={pressed}
                onClick={() => useNewJobDraft.getState().setCouncilRounds(n)}
                className={cls(styles.roundButton, pressed && styles.roundSelected)}
              >
                {newJobStrings.council.roundOption(n)}
              </button>
            );
          })}
        </div>
        <span className={styles.roundsSubtext}>{newJobStrings.council.roundsSubtext}</span>
      </div>
    </section>
  );
}
