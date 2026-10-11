/** Agent tile, status dot and status pill. Status always comes with a word (DESIGN_RULES rule 9). */
import type { StatusTone, StatusView } from '../model/statusModel.js';
import type { AgentBadge } from '../model/statusModel.js';
import styles from './Badges.module.css';
import { cx } from './cx.js';

const AGENT_CLASS: Record<AgentBadge['tone'], string | undefined> = {
  cc: styles.agentCc,
  cx: styles.agentCx,
  gm: styles.agentGm,
  oc: styles.agentOc,
  ag: styles.agentAg,
};

const DOT_CLASS: Record<StatusTone, string | undefined> = {
  info: styles.dotInfo,
  ok: styles.dotOk,
  warn: styles.dotWarn,
  neutral: styles.dotNeutral,
};

const PILL_CLASS: Record<StatusTone, string | undefined> = {
  info: styles.pillInfo,
  ok: styles.pillOk,
  warn: styles.pillWarn,
  neutral: styles.pillNeutral,
};

export function AgentTile({ badge, size = 'small' }: { badge: AgentBadge; size?: 'small' | 'large' }) {
  const sizeClass = size === 'large' ? styles.tileLarge : styles.tileSmall;
  return <span className={cx(styles.tile, sizeClass, AGENT_CLASS[badge.tone])}>{badge.mono}</span>;
}

export function StatusDot({ view }: { view: StatusView }) {
  return <span className={cx(styles.dot, DOT_CLASS[view.tone])} title={view.label} />;
}

export function StatusPill({ view }: { view: StatusView }) {
  return (
    <span className={cx(styles.pill, PILL_CLASS[view.tone])}>
      <span className={cx(styles.pillDot, DOT_CLASS[view.tone])} aria-hidden="true" />
      {view.label}
    </span>
  );
}
