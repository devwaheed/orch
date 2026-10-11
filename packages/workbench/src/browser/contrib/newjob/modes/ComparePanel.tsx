/**
 * Compare mode panel: select 2–5 agents to run side-by-side, with optional
 * combine step. Follows design/prototype/Main.dc.html lines 798–814.
 */
import type { AgentId, AgentInfo } from '@orch/contracts';
import { Icon } from '../../../../../../../design/icons/Icon.js';
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

export interface ComparePanelProps {
  readonly agents: readonly AgentInfo[];
  readonly selectedAgents: readonly AgentId[];
  readonly combine: boolean;
}

export function ComparePanel({ agents, selectedAgents, combine }: ComparePanelProps) {
  return (
    <section aria-labelledby="cmp-h" className={styles.section}>
      <h2 id="cmp-h" className={styles.sectionTitle}>
        {newJobStrings.compare.heading}
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
              onClick={() => useNewJobDraft.getState().toggleCompareAgent(agent.id)}
              className={cls(styles.agentButton, selected && styles.selected)}
            >
              <span className={cls(styles.badge, badge.className)}>{badge.mono}</span>
              <span>{agent.displayName}</span>
              {selected ? <Icon name="check" size={13} className={cls(styles.checkIcon)} /> : null}
            </button>
          );
        })}
      </div>
      <label className={styles.combineRow}>
        <input
          type="checkbox"
          checked={combine}
          onChange={(e) => useNewJobDraft.getState().setCombine(e.target.checked)}
          className={styles.checkbox}
        />
        <span className={styles.combineText}>
          <span className={styles.combineTitle}>{newJobStrings.compare.combineLabel}</span>
          <span className={styles.combineSub}>{newJobStrings.compare.combineDesc}</span>
        </span>
      </label>
    </section>
  );
}
