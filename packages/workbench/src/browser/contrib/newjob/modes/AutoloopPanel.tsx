/**
 * Autoloop mode panel: select agents for Planner, Coder, and Reviewer roles.
 * Follows design/prototype/Main.dc.html lines 839–858.
 */
import type { AgentId, AgentInfo } from '@orchagents/contracts';
import { AUTOLOOP_ROLES } from '../newJobModel.js';
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
    <section aria-labelledby="lp-h" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="lp-h" className={styles.sectionTitle}>
          {newJobStrings.autoloop.heading}
        </h2>
        <p className={styles.sectionIntro}>{newJobStrings.autoloop.intro}</p>
      </div>
      {AUTOLOOP_ROLES.map(({ role }) => {
        const copy = newJobStrings.autoloop.roles[role];
        const assignedAgent = roles[role];
        return (
          <div key={role} className={styles.roleRow}>
            <div className={styles.roleMeta}>
              <span className={styles.roleTitle}>{copy.label}</span>
              <span className={styles.roleDesc}>{copy.desc}</span>
            </div>
            <div role="radiogroup" aria-label={copy.aria} className={styles.roleOptions}>
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
                    className={cls(styles.roleOption, checked && styles.selected)}
                  >
                    <span className={cls(styles.badge, badge.className)}>{badge.mono}</span>
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
