/** Agent tile, status dot and status pill. Status always comes with a word (DESIGN_RULES rule 9). */
import type { StatusTone, StatusView } from '../model/statusModel.js';
import type { AgentBadge } from '../model/statusModel.js';
import { cx } from './cx.js';

const AGENT_CLASS: Record<AgentBadge['tone'], string> = {
  cc: 'bg-cc-bg text-cc-fg',
  cx: 'bg-cx-bg text-cx-fg',
  gm: 'bg-gm-bg text-gm-fg',
  oc: 'bg-oc-bg text-oc-fg',
  ag: 'bg-ag-bg text-ag-fg',
};

const DOT_CLASS: Record<StatusTone, string> = {
  info: 'bg-info-dot',
  ok: 'bg-ok-dot',
  warn: 'bg-warn-solid',
  neutral: 'bg-faint',
};

const PILL_CLASS: Record<StatusTone, string> = {
  info: 'text-info bg-info-bg border-info-bg',
  ok: 'text-ok bg-ok-bg border-ok-bg',
  warn: 'text-warn bg-warn-bg border-warn-line',
  neutral: 'text-text3 bg-transparent border-strongline',
};

const TILE_SIZE: Record<'tiny' | 'small' | 'large', string> = {
  small: 'w-18px h-18px text-8p5 rounded-5px',
  tiny: 'w-7 h-7 text-7p5 rounded-xs',
  large: 'size-[calc(var(--space-10)_+_var(--space-2px))] text-11px rounded-md',
};

export function AgentTile({ badge, size = 'small' }: { badge: AgentBadge; size?: 'tiny' | 'small' | 'large' }) {
  return (
    <span className={cx('inline-flex items-center justify-center flex-none font-mono font-semibold', TILE_SIZE[size], AGENT_CLASS[badge.tone])}>
      {badge.mono}
    </span>
  );
}

export function StatusDot({ view }: { view: StatusView }) {
  return <span className={cx('flex-none w-[7px] h-[7px] rounded-full', DOT_CLASS[view.tone])} title={view.label} />;
}

export function StatusPill({ view }: { view: StatusView }) {
  return (
    <span className={cx('inline-flex items-center gap-2 px-3 py-1 rounded-pill border text-2xs whitespace-nowrap', PILL_CLASS[view.tone])}>
      <span className={cx('w-[6px] h-[6px] rounded-full', DOT_CLASS[view.tone])} aria-hidden="true" />
      {view.label}
    </span>
  );
}
